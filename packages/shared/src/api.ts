export type InstanceRole = "owner" | "admin" | "member";

export type UserDto = { id: string; email: string; name: string; role: InstanceRole };

export type ProjectDto = { id: string; slug: string; name: string; createdAt: number };

export type EnvironmentDto = { id: string; slug: string; name: string; position: number };

export type SecretDto = {
  key: string;
  path: string;
  version: number;
  comment: string;
  updatedAt: number;
  value?: string;
};

export type LoginResponse = { user: UserDto; token?: string; expiresAt: number };

export type SetupStatusDto = { needsSetup: boolean };
