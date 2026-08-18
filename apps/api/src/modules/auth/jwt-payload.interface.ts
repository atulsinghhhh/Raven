export interface JwtPayload {
  sub: string; // user id
  email: string;
  jti: string; // unique token id, used for logout/revocation
  iat?: number;
  exp?: number;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  jti: string;
  exp: number;
}
