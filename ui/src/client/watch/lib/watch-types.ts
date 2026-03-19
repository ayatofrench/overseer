export type VcsType = "jj" | "git" | "none";

export interface LogEntry {
  id: string;
  commitId: string;
  description: string;
  author: string;
  timestamp: string;
  empty: boolean;
  workingCopies: string;
}

export interface LogResponse {
  workingCopyId: string | null;
  entries: LogEntry[];
}

export interface DiffFile {
  path: string;
  changeType: "A" | "M" | "D" | "R";
}

export interface DiffResponse {
  rev: string;
  patch: string;
  truncated: boolean;
  files: DiffFile[];
}

export interface WorkspaceInfo {
  name: string;
  path: string;
  vcsType: VcsType;
}

export interface DetectResponse {
  type: VcsType;
  root: string;
}

export interface ProjectInfo {
  name: string;
  path: string;
  vcsType: VcsType;
  hasOverseer: boolean;
  workspaceCount: number;
  workspaceDir?: string;
}
