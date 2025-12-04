export interface Post {
  id: string;
  content: string;
  date: string;
  likes: number;
  imageUrl?: string;
  originalAuthor: string;
}

export enum AppStep {
  LOGIN = 'LOGIN',
  FILTER_INPUT = 'FILTER_INPUT',
  REVIEW = 'REVIEW',
  MIGRATING = 'MIGRATING',
  COMPLETED = 'COMPLETED'
}

export interface FilterResult {
  relevantPostIds: string[];
  reasoning?: string;
}

// Mock User Interface
export interface UserProfile {
  name: string;
  avatar: string;
  handle: string;
}