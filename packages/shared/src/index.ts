export const APP_NAME = 'NiteOwl';

export type ApiResponse<T> = {
  success: boolean;
  data: T | null;
  error: string | null;
};

export function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data, error: null };
}

export function err(message: string): ApiResponse<never> {
  return { success: false, data: null, error: message };
}
