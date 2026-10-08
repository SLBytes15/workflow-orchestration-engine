export interface Workflow {
  tenantId: string;
  name: string;
  description: string;
  status: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
