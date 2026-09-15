import { useState } from "react";
import { MessageCircleQuestion } from "lucide-react";
import type { AiUserAnswer, AiUserQuestion } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";

/**
 * A pending `ask_user` form. Sent by the server as a `user_question_request`
 * event during a streaming chat; the loop is paused until we reply.
 */
export type UserQuestionRequest = {
  id: string;
  questions: AiUserQuestion[];
};

type Props = {
  /** Pending request, or null when the assistant isn't waiting on us. */
  request: UserQuestionRequest | null;
  /** Called with the answers, or `null` when the user skips the form. */
  onSubmit: (id: string, answers: AiUserAnswer[] | null) => void;
};

/** Sentinel radio value for the free-text "Other" choice on multiple_choice questions. */
const OTHER = "__other__";

/** Per-question draft state, keyed by question index. */
type Draft = {
  value?: string | boolean | number;
  /** Free text typed into the "Other" field of a multiple_choice question. */
  other?: string;
};

function draftToAnswer(q: AiUserQuestion, d: Draft | undefined): AiUserAnswer["answer"] | undefined {
  switch (q.type) {
    case "true_false":
      return typeof d?.value === "boolean" ? d.value : undefined;
    case "multiple_choice":
      if (d?.value === OTHER) return d.other?.trim() ? d.other.trim() : undefined;
      return typeof d?.value === "string" ? d.value : undefined;
    case "open_ended":
      return typeof d?.value === "string" && d.value.trim() ? d.value.trim() : undefined;
    case "slider":
      // Sliders always have a value: default to the midpoint if untouched.
      return typeof d?.value === "number" ? d.value : 50;
  }
}

/**
 * Renders the assistant's question form directly above the message composer
 * (same width as the composer). Submit is enabled only once every question
 * has an answer; Skip lets the assistant continue with a default.
 */
export function UserQuestionCard({ request, onSubmit }: Props) {
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});

  if (!request) return null;

  const patch = (i: number, p: Draft) =>
    setDrafts((prev) => ({ ...prev, [i]: { ...prev[i], ...p } }));

  const answers = request.questions.map((q, i) => draftToAnswer(q, drafts[i]));
  const complete = answers.every((a) => a !== undefined);

  const submit = () => {
    onSubmit(
      request.id,
      request.questions.map((q, i) => ({ question: q.question, type: q.type, answer: answers[i] ?? null })),
    );
    setDrafts({});
  };
  const skip = () => {
    onSubmit(request.id, null);
    setDrafts({});
  };

  return (
    <div className="rounded-lg border bg-background p-3 shadow-sm" data-testid="user-question-card">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <MessageCircleQuestion className="h-4 w-4 text-muted-foreground" />
        The assistant has a question
      </div>
      <div className="flex flex-col gap-4">
        {request.questions.map((q, i) => {
          const d = drafts[i];
          const name = `uq-${request.id}-${i}`;
          return (
            <div key={i} className="flex flex-col gap-2" data-testid={`user-question-${i}`}>
              <Label className="text-sm leading-snug">{q.question}</Label>

              {q.type === "true_false" && (
                <RadioGroup
                  className="flex gap-4"
                  value={typeof d?.value === "boolean" ? String(d.value) : ""}
                  onValueChange={(v) => patch(i, { value: v === "true" })}
                >
                  {[["true", "Yes"], ["false", "No"]].map(([v, label]) => (
                    <div key={v} className="flex items-center gap-2">
                      <RadioGroupItem value={v} id={`${name}-${v}`} />
                      <Label htmlFor={`${name}-${v}`} className="font-normal">{label}</Label>
                    </div>
                  ))}
                </RadioGroup>
              )}

              {q.type === "multiple_choice" && (
                <RadioGroup
                  value={typeof d?.value === "string" ? d.value : ""}
                  onValueChange={(v) => patch(i, { value: v })}
                >
                  {q.choices.map((c, ci) => (
                    <div key={ci} className="flex items-center gap-2">
                      <RadioGroupItem value={c} id={`${name}-${ci}`} />
                      <Label htmlFor={`${name}-${ci}`} className="font-normal">{c}</Label>
                    </div>
                  ))}
                  {q.allowOther !== false && (
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value={OTHER} id={`${name}-other`} />
                      <Label htmlFor={`${name}-other`} className="font-normal">Other</Label>
                      <Input
                        value={d?.other ?? ""}
                        onFocus={() => patch(i, { value: OTHER })}
                        onChange={(e) => patch(i, { value: OTHER, other: e.target.value })}
                        placeholder="Type your own answer…"
                        className="h-8 flex-1"
                        data-testid={`user-question-${i}-other`}
                      />
                    </div>
                  )}
                </RadioGroup>
              )}

              {q.type === "open_ended" && (
                <Textarea
                  value={typeof d?.value === "string" ? d.value : ""}
                  onChange={(e) => patch(i, { value: e.target.value })}
                  rows={2}
                  className="min-h-[2.5rem] resize-none"
                  data-testid={`user-question-${i}-text`}
                />
              )}

              {q.type === "slider" && (
                <div className="flex flex-col gap-1 px-1">
                  <Slider
                    min={0}
                    max={100}
                    step={1}
                    value={[typeof d?.value === "number" ? d.value : 50]}
                    onValueChange={([v]) => patch(i, { value: v })}
                    data-testid={`user-question-${i}-slider`}
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{q.lowLabel}</span>
                    <span className="tabular-nums">{typeof d?.value === "number" ? d.value : 50}</span>
                    <span>{q.highLabel}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={skip} data-testid="button-user-question-skip">
          Skip
        </Button>
        <Button type="button" size="sm" onClick={submit} disabled={!complete} data-testid="button-user-question-submit">
          Submit
        </Button>
      </div>
    </div>
  );
}
