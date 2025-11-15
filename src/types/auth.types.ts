export interface ILoginCredentials {
  email: string;
  password: string;
}

export interface IAuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface IRefreshToken {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface IPasswordReset {
  email: string;
  token: string;
  password: string;
}

export interface IChangePassword {
  currentPassword: string;
  newPassword: string;
}
