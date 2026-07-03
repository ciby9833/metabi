import { api } from '@/lib/api';
import { CreateTaskPayload, ListResponse, Task } from '@/types';

export const taskService = {
  async list(): Promise<ListResponse<Task>> {
    const res = await api.get<ListResponse<Task>>('/v1/task');
    return res.data;
  },

  async create(payload: CreateTaskPayload): Promise<Task> {
    const res = await api.post<Task>('/v1/task', payload);
    return res.data;
  },

  async getById(id: string): Promise<Task> {
    const res = await api.get<Task>(`/v1/task/${id}`);
    return res.data;
  },

  async update(id: string, payload: Partial<CreateTaskPayload>): Promise<Task> {
    const res = await api.patch<Task>(`/v1/task/${id}`, payload);
    return res.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/v1/task/${id}`);
  },

  async execute(id: string): Promise<unknown> {
    const res = await api.post(`/v1/task/${id}/execute`);
    return res.data;
  },
};
