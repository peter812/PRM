import { useState, useEffect } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { X, Trash2, Plus, Briefcase, GraduationCap, School } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { type PersonWithRelations } from "@shared/schema";
import { z } from "zod";

const jobExperienceSchema = z.object({
  company: z.string().min(1, "Company is required"),
  position: z.string().min(1, "Position is required"),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
});

const collegeSchema = z.object({
  name: z.string().min(1, "College name is required"),
  degree: z.string().min(1, "Degree is required"),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
});

const additionalSchoolingSchema = z.object({
  name: z.string().min(1, "School name is required"),
  course: z.string().optional().nullable(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
});

const additionalInfoSchema = z.object({
  maidenName: z.string().optional().nullable(),
  jobs: z.array(jobExperienceSchema).default([]),
  schooling: z.object({
    highSchool: z.string().optional().nullable(),
    colleges: z.array(collegeSchema).default([]),
    additionalSchooling: z.array(additionalSchoolingSchema).default([]),
  }).default({ highSchool: "", colleges: [], additionalSchooling: [] }),
});

type FormValues = z.infer<typeof additionalInfoSchema>;

interface AdditionalInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  person: PersonWithRelations;
}

export function AdditionalInfoDialog({
  open,
  onOpenChange,
  person,
}: AdditionalInfoDialogProps) {
  const { toast } = useToast();

  const form = useForm<FormValues>({
    resolver: zodResolver(additionalInfoSchema),
    defaultValues: {
      maidenName: "",
      jobs: [],
      schooling: {
        highSchool: "",
        colleges: [],
        additionalSchooling: [],
      },
    },
  });

  const { fields: jobFields, append: appendJob, remove: removeJob } = useFieldArray({
    control: form.control,
    name: "jobs",
  });

  const { fields: collegeFields, append: appendCollege, remove: removeCollege } = useFieldArray({
    control: form.control,
    name: "schooling.colleges",
  });

  const { fields: additionalSchoolFields, append: appendAdditionalSchool, remove: removeAdditionalSchool } = useFieldArray({
    control: form.control,
    name: "schooling.additionalSchooling",
  });

  useEffect(() => {
    if (open && person) {
      form.reset({
        maidenName: person.maidenName || "",
        jobs: person.jobs || [],
        schooling: {
          highSchool: person.schooling?.highSchool || "",
          colleges: person.schooling?.colleges || [],
          additionalSchooling: person.schooling?.additionalSchooling || [],
        },
      });
    }
  }, [open, person, form]);

  const mutation = useMutation({
    mutationFn: async (data: FormValues) => {
      const res = await apiRequest("PATCH", `/api/people/${person.id}`, {
        maidenName: data.maidenName || null,
        jobs: data.jobs,
        schooling: data.schooling,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/people", person.id] });
      toast({
        title: "Success",
        description: "Additional info updated successfully",
      });
      onOpenChange(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update additional info",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: FormValues) => {
    mutation.mutate(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-additional-info">
        <DialogHeader>
          <DialogTitle>Edit Education & Career</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            
            {/* Personal Details Section */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold flex items-center gap-2 border-b pb-2 text-foreground/80">
                Personal Info
              </h3>
              <FormField
                control={form.control}
                name="maidenName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Maiden Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. Smith"
                        {...field}
                        value={field.value || ""}
                        data-testid="input-maiden-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Schooling Section */}
            <div className="space-y-6">
              <h3 className="text-sm font-semibold flex items-center gap-2 border-b pb-2 text-foreground/80">
                <School className="h-4 w-4 text-primary" />
                Schooling History
              </h3>

              <FormField
                control={form.control}
                name="schooling.highSchool"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>High School</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. Central High School"
                        {...field}
                        value={field.value || ""}
                        data-testid="input-highschool"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Colleges & Degrees */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <FormLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Colleges & Degrees
                  </FormLabel>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => appendCollege({ name: "", degree: "", startDate: "", endDate: "" })}
                    className="h-7 text-xs flex items-center gap-1"
                    data-testid="button-add-college"
                  >
                    <Plus className="h-3 w-3" /> Add College
                  </Button>
                </div>

                {collegeFields.map((item, index) => (
                  <div
                    key={item.id}
                    className="p-4 border rounded-lg bg-card/50 space-y-3 relative group/item"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 h-7 w-7 text-muted-foreground hover:text-destructive opacity-0 group-hover/item:opacity-100 transition-opacity"
                      onClick={() => removeCollege(index)}
                      aria-label="Remove college"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pr-6">
                      <FormField
                        control={form.control}
                        name={`schooling.colleges.${index}.name`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">College/University</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. Stanford University" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`schooling.colleges.${index}.degree`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Degree</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. B.S. in Computer Science" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3 max-w-md pr-6">
                      <FormField
                        control={form.control}
                        name={`schooling.colleges.${index}.startDate`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Start Year/Date</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. 2012" {...field} value={field.value || ""} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`schooling.colleges.${index}.endDate`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">End Year/Date</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. 2016" {...field} value={field.value || ""} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Additional Schooling */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <FormLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Additional Schooling
                  </FormLabel>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => appendAdditionalSchool({ name: "", course: "", startDate: "", endDate: "" })}
                    className="h-7 text-xs flex items-center gap-1"
                    data-testid="button-add-additional-school"
                  >
                    <Plus className="h-3 w-3" /> Add Schooling
                  </Button>
                </div>

                {additionalSchoolFields.map((item, index) => (
                  <div
                    key={item.id}
                    className="p-4 border rounded-lg bg-card/50 space-y-3 relative group/item"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 h-7 w-7 text-muted-foreground hover:text-destructive opacity-0 group-hover/item:opacity-100 transition-opacity"
                      onClick={() => removeAdditionalSchool(index)}
                      aria-label="Remove schooling"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pr-6">
                      <FormField
                        control={form.control}
                        name={`schooling.additionalSchooling.${index}.name`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">School/Bootcamp/Academy</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. Y Combinator" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`schooling.additionalSchooling.${index}.course`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Course/Program</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. Startup School" {...field} value={field.value || ""} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3 max-w-md pr-6">
                      <FormField
                        control={form.control}
                        name={`schooling.additionalSchooling.${index}.startDate`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Start Year/Date</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. 2018" {...field} value={field.value || ""} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`schooling.additionalSchooling.${index}.endDate`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">End Year/Date</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. 2018" {...field} value={field.value || ""} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Employment History Section */}
            <div className="space-y-6">
              <h3 className="text-sm font-semibold flex items-center gap-2 border-b pb-2 text-foreground/80">
                <Briefcase className="h-4 w-4 text-primary" />
                Employment History
              </h3>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <FormLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Job Experiences
                  </FormLabel>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => appendJob({ company: "", position: "", startDate: "", endDate: "" })}
                    className="h-7 text-xs flex items-center gap-1"
                    data-testid="button-add-job"
                  >
                    <Plus className="h-3 w-3" /> Add Job
                  </Button>
                </div>

                {jobFields.map((item, index) => (
                  <div
                    key={item.id}
                    className="p-4 border rounded-lg bg-card/50 space-y-3 relative group/item"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 h-7 w-7 text-muted-foreground hover:text-destructive opacity-0 group-hover/item:opacity-100 transition-opacity"
                      onClick={() => removeJob(index)}
                      aria-label="Remove job"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pr-6">
                      <FormField
                        control={form.control}
                        name={`jobs.${index}.company`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Company *</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. Google" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`jobs.${index}.position`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Position *</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. Senior Software Engineer" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3 max-w-md pr-6">
                      <FormField
                        control={form.control}
                        name={`jobs.${index}.startDate`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Start Date</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. Jan 2020" {...field} value={field.value || ""} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`jobs.${index}.endDate`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">End Date</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. Present" {...field} value={field.value || ""} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                data-testid="button-cancel-additional-info"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={mutation.isPending}
                data-testid="button-save-additional-info"
              >
                Save
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
