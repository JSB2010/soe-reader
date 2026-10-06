export type Status = "queued" | "processing" | "ready" | "failed" | "deleted";
export type Rect = [number, number, number, number];
export type Segment = {
  id: string;
  page: number;
  text: string;
  rects: Rect[];
  itemIndices: number[];
  audio: string;
};
export type Manifest = {
  extractionVersion: 1;
  coordinateSystem: "pdf-user-space";
  pages: { page: number; width: number; height: number; rotation: number }[];
  segments: Segment[];
  warnings: string[];
};
export type ReaderDocument = {
  id: string;
  ownerId: string;
  title: string;
  version: string;
  status: Status;
  enabled: boolean;
  availableAt: number;
  expiresAt: number;
  timezone: string;
  voice: string;
  createdAt: number;
  updatedAt: number;
  pdfBytes: number;
  tokenHash: string;
  encryptedToken: string;
  pages: number;
  totalSegments: number;
  completedSegments: number;
  warnings: string[];
  error: string | null;
  leaseId: string | null;
  leaseUntil: number;
  attempts: number;
  quotaReserved: boolean;
};
export type Identity = { id: string; email: string; name: string };
export type Task = { documentId: string; version: string; generation: string };
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "request_failed",
  ) {
    super(message);
  }
}
export const basePath = (doc: Pick<ReaderDocument, "id" | "version">) =>
  `documents/${doc.id}/${doc.version}`;
export const pdfPath = (doc: Pick<ReaderDocument, "id" | "version">) =>
  `${basePath(doc)}/original.pdf`;
export const manifestPath = (doc: Pick<ReaderDocument, "id" | "version">) =>
  `${basePath(doc)}/manifest.json`;
