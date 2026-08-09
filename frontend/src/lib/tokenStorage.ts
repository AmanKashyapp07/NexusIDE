/**
 * Isolated Token Storage for NexusIDE.
 * Uses 'nexus_ide_token' key to prevent token collision with MagnusCI ('magnus_ci_token') on the same domain origin.
 */
export const getNexusToken = (): string => {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('nexus_ide_token') || localStorage.getItem('token') || '';
};

export const setNexusToken = (token: string): void => {
  if (typeof window === 'undefined') return;
  localStorage.setItem('nexus_ide_token', token);
  localStorage.setItem('token', token);
};

export const removeNexusToken = (): void => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('nexus_ide_token');
  localStorage.removeItem('token');
};
