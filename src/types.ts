// Shared types for the MVP.

export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  // Optional context included at send time (e.g. selected text from the editor).
  selection?: string;
  createdAt: number;
}

export interface DocumentRecord {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface Revision {
  id: string;
  documentId: string;
  // Snapshot of the document content at this point in time.
  content: string;
  createdAt: number;
  // Optional short label (auto-generated or user-supplied).
  label?: string;
}

export interface Prompt {
  id: string;
  name: string;
  body: string;
  createdAt: number;
}

export interface ProposedEdit {
  id: string;
  summary: string;
  original: string;
  replacement: string;
}

export type Theme = 'light' | 'dark';

export interface ApiConfig {
  apiKey: string;
  // Either a full chat-completions URL or a base URL (we will append /chat/completions).
  apiEndpoint: string;
  model: string;
  systemMessage: string;
  temperature: number;
}
