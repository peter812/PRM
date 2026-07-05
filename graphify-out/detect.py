import json
from graphify.detect import detect
from pathlib import Path

result = detect(Path('.'))
# Save the detect JSON
Path('graphify-out/.graphify_detect.json').write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
print("Done")
