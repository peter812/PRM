import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ROLE_LABELS,
  USER_ROLES,
  canAssignRole,
  canManageUser,
  type User,
  type UserRole,
} from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Users as UsersIcon,
  MoreHorizontal,
  ShieldCheck,
  Shield,
  UserPlus,
  KeyRound,
  Trash2,
  Lock,
  AlertCircle,
} from "lucide-react";

/** Users come back from the API without their password hash. */
type SafeUser = Omit<User, "password">;

const createUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  nickname: z.string().min(1, "Nickname is required"),
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(USER_ROLES),
});
type CreateUserForm = z.infer<typeof createUserSchema>;

const passwordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
});
type PasswordForm = z.infer<typeof passwordSchema>;

function RoleBadge({ role }: { role: UserRole }) {
  if (role === "super_admin") {
    return (
      <Badge variant="default" className="gap-1">
        <ShieldCheck className="h-3 w-3" />
        {ROLE_LABELS[role]}
      </Badge>
    );
  }
  if (role === "admin") {
    return (
      <Badge variant="secondary" className="gap-1">
        <Shield className="h-3 w-3" />
        {ROLE_LABELS[role]}
      </Badge>
    );
  }
  return <Badge variant="outline">{ROLE_LABELS[role]}</Badge>;
}

export default function AdminUsersPage() {
  const { user: me } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<SafeUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SafeUser | null>(null);

  const {
    data: users,
    isLoading,
    error,
    refetch,
  } = useQuery<SafeUser[]>({ queryKey: ["/api/users"] });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/users"] });

  const createForm = useForm<CreateUserForm>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: "", nickname: "", username: "", password: "", role: "user" },
  });

  const passwordForm = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: "" },
  });

  const createMutation = useMutation({
    mutationFn: async (data: CreateUserForm) => {
      const res = await apiRequest("POST", "/api/users", data);
      return res.json();
    },
    onSuccess: (created: SafeUser) => {
      refresh();
      setCreateOpen(false);
      createForm.reset();
      toast({
        title: "Account created",
        description: `${created.username} can sign in now. Share the password with them directly.`,
      });
    },
    onError: (error: Error) =>
      toast({ title: "Could not create account", description: error.message, variant: "destructive" }),
  });

  const roleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: number; role: UserRole }) => {
      const res = await apiRequest("PATCH", `/api/users/${id}`, { role });
      return res.json();
    },
    onSuccess: (updated: SafeUser) => {
      refresh();
      toast({ title: `${updated.username} is now ${ROLE_LABELS[updated.role].toLowerCase()}` });
    },
    onError: (error: Error) =>
      toast({ title: "Could not change role", description: error.message, variant: "destructive" }),
  });

  const passwordMutation = useMutation({
    mutationFn: async ({ id, password }: { id: number; password: string }) =>
      apiRequest("POST", `/api/users/${id}/password`, { password }),
    onSuccess: () => {
      setPasswordTarget(null);
      passwordForm.reset();
      toast({ title: "Password reset", description: "Share the new password with them directly." });
    },
    onError: (error: Error) =>
      toast({ title: "Could not reset password", description: error.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/users/${id}`),
    onSuccess: () => {
      refresh();
      setDeleteTarget(null);
      toast({ title: "Account deleted" });
    },
    onError: (error: Error) =>
      toast({ title: "Could not delete account", description: error.message, variant: "destructive" }),
  });

  const myRole = (me?.role ?? "user") as UserRole;
  // The roles this admin is allowed to hand out. An admin cannot mint a super
  // admin — only another super admin can.
  const assignableRoles = USER_ROLES.filter((r) => canAssignRole(myRole, r));

  return (
    <div className="container max-w-full md:max-w-5xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="space-y-2 mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-admin-users-title">
          <UsersIcon className="h-6 w-6" />
          Users
        </h1>
        <p className="text-muted-foreground">
          Accounts on this instance. There is no open registration — every account is created here.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-lg">All accounts</CardTitle>
            <CardDescription>
              {error
                ? "Could not load accounts"
                : users
                  ? `${users.length} account${users.length === 1 ? "" : "s"}`
                  : "Loading…"}
            </CardDescription>
          </div>
          <Button onClick={() => setCreateOpen(true)} data-testid="button-create-user">
            <UserPlus className="h-4 w-4 mr-2" />
            New user
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : error ? (
            // Never render a failed fetch as an empty table — "no accounts" and
            // "the request failed" look identical to the reader otherwise.
            <div
              className="flex flex-col items-center gap-3 py-8 text-center"
              data-testid="users-load-error"
            >
              <AlertCircle className="h-8 w-8 text-destructive" />
              <div>
                <p className="text-sm font-medium">Could not load accounts</p>
                <p className="text-xs text-muted-foreground mt-1">{error.message}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Try again
              </Button>
            </div>
          ) : !users?.length ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No accounts returned. That should be impossible while you are signed in — try
              reloading.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Username</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users?.map((u) => {
                    const manageable = me ? canManageUser({ id: me.id, role: myRole }, u) : false;
                    const isSelf = u.id === me?.id;
                    return (
                      <TableRow key={u.id} data-testid={`row-user-${u.id}`}>
                        <TableCell className="font-medium">
                          {u.name}
                          {isSelf && <span className="text-muted-foreground font-normal"> (you)</span>}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{u.username}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <RoleBadge role={u.role} />
                            {!manageable && (
                              <span
                                className="text-muted-foreground"
                                title="Only a super admin can modify a super admin"
                              >
                                <Lock className="h-3 w-3" />
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={!manageable}
                                data-testid={`button-user-actions-${u.id}`}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {assignableRoles
                                .filter((r) => r !== u.role)
                                .map((r) => (
                                  <DropdownMenuItem
                                    key={r}
                                    disabled={isSelf}
                                    onClick={() => roleMutation.mutate({ id: u.id, role: r })}
                                  >
                                    <Shield className="h-4 w-4 mr-2" />
                                    Make {ROLE_LABELS[r].toLowerCase()}
                                  </DropdownMenuItem>
                                ))}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => setPasswordTarget(u)}>
                                <KeyRound className="h-4 w-4 mr-2" />
                                Reset password
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={isSelf}
                                className="text-destructive focus:text-destructive"
                                onClick={() => setDeleteTarget(u)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete account
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Create ─────────────────────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New user</DialogTitle>
            <DialogDescription>
              They get their own &ldquo;Me&rdquo; person and a private space for notes, daily notes and
              tasks. Contacts and groups stay shared.
            </DialogDescription>
          </DialogHeader>
          <Form {...createForm}>
            <form
              onSubmit={createForm.handleSubmit((data) => createMutation.mutate(data))}
              className="space-y-4"
            >
              <FormField
                control={createForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full name</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-new-user-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="nickname"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nickname</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-new-user-nickname" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <Input {...field} autoComplete="off" data-testid="input-new-user-username" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Temporary password</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        autoComplete="new-password"
                        data-testid="input-new-user-password"
                      />
                    </FormControl>
                    <FormDescription>
                      Give this to them directly. They can change it in User Options.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-new-user-role">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {assignableRoles.map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Creating…" : "Create user"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Reset password ─────────────────────────────────────────────────── */}
      <Dialog open={!!passwordTarget} onOpenChange={(open) => !open && setPasswordTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              Set a new password for {passwordTarget?.username}. Their existing sessions stay signed in.
            </DialogDescription>
          </DialogHeader>
          <Form {...passwordForm}>
            <form
              onSubmit={passwordForm.handleSubmit(({ password }) =>
                passwordTarget && passwordMutation.mutate({ id: passwordTarget.id, password })
              )}
              className="space-y-4"
            >
              <FormField
                control={passwordForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New password</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        autoComplete="new-password"
                        data-testid="input-reset-password"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setPasswordTarget(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={passwordMutation.isPending}>
                  {passwordMutation.isPending ? "Saving…" : "Reset password"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Delete ─────────────────────────────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.username}?</AlertDialogTitle>
            <AlertDialogDescription>
              Their notes, daily notes and tasks are deleted along with their &ldquo;Me&rdquo; person.
              Contacts, groups and interactions they created stay, but lose their attribution and
              become visible to everyone. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              data-testid="button-confirm-delete-user"
            >
              Delete account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
