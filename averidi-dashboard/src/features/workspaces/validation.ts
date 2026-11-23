import { z } from "zod";
export const workspaceNameSchema=z.string().trim().min(2).max(120);
