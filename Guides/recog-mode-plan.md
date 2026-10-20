# Recog mode

Recog is a PRM-VR mode. It reads the Quest 3 passthrough RGB camera, finds faces, identifies them against PRM's named identities, and pins a name tag over each person.

Status: built (2026-10-18), both Option A and Option B. Not yet run on a headset.

Consent: everyone who will come in contact with the device has consented to its use.

---

## Decisions
- **Two sub-modes**, picked on the Recog page of the quick menu:
  - **Detect** (default): finds faces and draws a green outline with the confidence %. Nothing is sent to PRM.
  - **Identify**: also asks PRM who each face is and pins a name tag.
- **Its own settings.** `RecogSettings` (stored as `prm.vr.recog`) and `RecogSettingsPanel` share nothing with the graph settings. The graph settings panel only offers People/Social.
- **Both identify options are built.** "Embed on headset" in the Recog settings panel picks between them:
  - **A** (default): the headset detects and aligns faces, then uploads 112×112 JPEG crops. PRM-Compute embeds them.
  - **B**: the headset also runs ArcFace and uploads only the 512-d embeddings.
- **Works remotely.** Requests are small (about 5 KB per crop, 2 KB per embedding) and time out after 5 s. A late answer is dropped and the next try replaces it.
- **Matches every named identity**, people and social accounts, through the existing `face-lookalikes` centroids.
- **Separate, exclusive mode.** The graph is hidden, passthrough is forced on, and the camera and models run only while in Recog.
- **Face images are one-time use.** PRM and compute hold crops in memory for the length of the request only. Nothing is written to `faces`, S3 or disk. On the headset, a crop lives only until the request takes it, and the frame buffer and models are released when the mode is left.
- Unknown faces get a grey "Unknown" tag. There is no add-person flow and no sighting log.
- Tap-for-details was dropped. InfoBubble is tied to graph nodes, so tags show name, @username and score instead.

## Pieces

### Quest (`PRM-VR/Assets/PRM_VR/Scripts/Recog/`)

**`FaceDetector`** runs YuNet 2023mar (`Resources/Models/face_detection_yunet_2023mar.onnx`) on Inference Engine GPUCompute:
- Input is 640×640 BGR at 0–255, letterboxed top-left.
- Output is boxes, 5 landmarks and a score. The threshold is the "Min confidence" setting (default 0.6), and NMS is at IoU 0.3.
- Decoding was checked against `cv2.FaceDetectorYN` on the playbill images, and the boxes are identical.

**`FaceAligner`** applies a 5-point similarity transform to compute's `_REFERENCE_PTS`, samples bilinearly and outputs 112×112 RGB.
- Compute uses `cv2.estimateAffinePartial2D` (RANSAC, 3 px).
- The port fits all 5 points. If any point is more than 3 px off, it tries every pair and keeps the one with the most inliers, breaking ties on the smallest residual, then refits on those inliers.
- Parity against compute on the same 23 faces: 20 reach cosine 1.0000 and 3 reach 0.93–0.95, where cv2's random sampling picks different inliers.

**`FaceEmbedder`** (Option B only) runs ArcFace w600k_r50 (`Resources/Models/arcface_w600k_r50.onnx`) on GPUCompute.
- Preprocessing is the same as compute's `_embed`: RGB, (x − 127.5)/128, then an L2-normalised output.

**`RecogController`** runs the loop and draws the tags.
- **Loop:** aims for about 15 Hz. It waits only for whatever is left of the 0.066 s interval after detection, acquires the CPU image, detects faces and tracks them by IoU (a track drops after 1 s unseen).
  - Meta's provider never advances the image timestamp, so frames are not de-duplicated.
  - In Detect the camera converts the 1280×1280 frame to 640×640 itself. Identify keeps full size, for sharper crops.
  - The detector keeps one input tensor on the GPU and uploads into it each frame. The letterbox uses a cached column table and skips clearing when the square frame fills the input.
  - Every 5 s the log gets a `[Recog] timing:` line with the rate and the average milliseconds for acquire+convert, letterbox+upload and model+readback. Use it to choose the next speed fix.
    - Measured 2026-10-19 on a 1280 frame: acquire+convert 4 ms, letterbox+upload 3 ms, model+readback 40 ms, so about 47 ms of work. The old 0.15 s interval held the loop at 6 Hz, so it was cut to 0.066 s.
  - The detector starts all 12 output readbacks before awaiting any of them. Measured before this change: about 0.5 s per detection (about 1.5 Hz).
- **Keeping identified people:** a track PRM is `sure` about is kept, hidden, for 8 s after its face leaves view.
  - A new face whose tag position lands within 0.5 m of a kept track takes it over, keeping the name with no new PRM call.
  - This matches by world position, because image boxes no longer line up once the head has moved. IoU matching only uses tracks seen in the last 1 s.
- **Camera view:** four green corner brackets, head-locked 1.5 m ahead, mark what the camera can see. They are built from the camera intrinsics, so they match the frame the detector gets.
- **Preview:** while the Recog settings panel is open, a 320×320 copy of the frame, with found faces boxed, shows at the top of the panel. It is the first thing to check if faces aren't found (see Manual steps 3).
- **Queries (Identify only):**
  - Only one request is in flight at a time.
  - A track is queried when its face is at least "Min face size" wide (default 40 px).
  - It is re-queried every 2 s until PRM is `sure`, and then never again.
- **Tags:**
  - Placement: the tag sits on a pinhole ray through the top-centre of the box. Depth is estimated from a 15 cm face width.
  - "Estimate face distance" (Recog Settings, on by default): turned off, tags and Detect boxes skip the depth guess and sit flat on the corner-bracket plane, 1.5 m out.
  - Billboarding: tags are smoothed and turn to face the user.
  - Colours: green for sure, amber with a score % for unsure, grey for Unknown.

**Wiring:**
- `GraphMode.Recog` is the third segment in the quick menu. In Recog the menu shows Detect/Identify and Recog Settings instead of the graph controls; the People/Social segment is the way back.
- `PRMVRApp.ApplyModeAsync` switches between the graph and Recog.
- `PRMClient.RecognizeCropsAsync` and `PRMClient.RecognizeEmbeddingsAsync` make the server calls.

### PRM server
- `POST /api/vr/recognize` (`server/routes/recog.ts`) takes multipart `crops` (A) or JSON `{ embeddings }` (B).
- For A, it calls compute's `/api/face/embed-aligned`.
- It then scores against the centroids with `lookAlikesForEmbeddings` (`server/face-lookalikes.ts`).
- It returns `faces[{ match: null | { personId, socialAccountId, username, label, personfaceUuid, score, sure } }]`.
- `sure` means the score is at least the auto-assign score, with a clear margin over the runner-up.

### PRM-compute
- `POST /api/face/embed-aligned` (`routers/detect.py`) uses `face_engine.embed_aligned_faces`. It embeds up to 16 already-aligned crops and saves nothing.

## Manual and on-device steps
1. **Camera Image Support.** `m_CameraImageSupport` is set to 1 for Android in `Assets/XR/Settings/OpenXRPackageSettings.asset`. Check it under Project Settings → XR Plug-in Management → OpenXR → Android → Meta Quest: Camera (Passthrough). Unity rewrites the asset if the editor had it open.
2. **Permission.** The app asks for `horizonos.permission.HEADSET_CAMERA` on entry and then restarts `ARCameraManager`. Horizon OS v74 or later is needed.
3. **Faces not found.** On the first device run, Detect found no faces. Open Recog Settings and look at the preview:
   - Upside down: `XRCpuImage.Convert` isn't giving rows top-down as the code assumes. Flip the rows after the convert.
   - Wrong colours: the RGBA channel order assumption is wrong.
   - Looks right but no boxes: lower "Min confidence".
   - Found on device (2026-10-19): the loop skipped every frame after the first because it de-duplicated on `XRCpuImage.timestamp`, which Meta's provider doesn't advance. The check is gone. Frames arrive as 1280×1280.
4. **Lens pose.** The camera's position and downward tilt are read from Camera2's `LENS_POSE_TRANSLATION`/`LENS_POSE_ROTATION` for camera `50` (the one Meta's provider opens) and logged as `[Recog] lens pose`. If that read fails, it falls back to a straight-ahead offset of (−0.032, −0.02, 0.06) m and tags sit too high. `LENS_POSE_ROTATION` maps the device frame to the camera's, so it has to be inverted. Without the inverse (found 2026-10-19), the Quest 3 camera came out 11° up (euler x ≈ 349) instead of 11° down (euler x ≈ 11), and the bracket frame sat too high.
5. **APK size.** ArcFace adds about 170 MB. If Option B isn't wanted, delete `arcface_w600k_r50.onnx`; Option A doesn't need it.
6. **Performance.** Check Option B's per-face embed time and thermals with the OVR Metrics Tool.

## Limits
- The camera's FOV is narrower than the user's view, so only faces the camera can see get tags.
- Faces smaller than "Min face size" (40 px is about 3 m or more away) aren't queried.
