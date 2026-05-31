import { useState } from "react";
import { Plus, Trash2, Edit2, RefreshCw } from "lucide-react";
import {
  useProviders,
  useCreateProvider,
  useUpdateProvider,
  useDeleteProvider,
} from "../lib/queries";
import { type ManagedAiProvider } from "../lib/ai-providers";
import { fetchProviderModels } from "../lib/api-client";
import { alertDialog } from "./ui/dialog";

export default function AiProvidersCard() {
  const { data, isLoading } = useProviders();
  const providers = (data as any)?.providers || [];
  const createMut = useCreateProvider();
  const updateMut = useUpdateProvider();
  const deleteMut = useDeleteProvider();

  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formData, setFormData] = useState<Partial<ManagedAiProvider>>({
    name: "",
    type: "openai",
    apiKey: "",
    endpoint: "",
    modelId: "",
  });
  const [fetchingModels, setFetchingModels] = useState(false);

  const handleFetchModels = async () => {
    if (!editingId) return;
    setFetchingModels(true);
    try {
      const models = await fetchProviderModels(editingId);
      void alertDialog({
        title: "Available Models",
        message: models.join(", "),
      });
    } catch (err) {
      void alertDialog({
        title: "Fetch Failed",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setFetchingModels(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      type: "openai",
      apiKey: "",
      endpoint: "",
      modelId: "",
    });
    setIsAdding(false);
    setEditingId(null);
  };

  const handleEdit = (provider: ManagedAiProvider) => {
    setFormData(provider);
    setEditingId(provider.id);
    setIsAdding(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      await updateMut.mutateAsync({ id: editingId, provider: formData });
    } else {
      await createMut.mutateAsync(formData);
    }
    resetForm();
  };

  if (isLoading) return <div>Loading providers...</div>;

  return (
    <div className="card bg-base-100 shadow-sm border border-base-300">
      <div className="card-body p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="card-title text-lg font-bold">AI Providers</h2>
          {!isAdding && !editingId && (
            <button
              onClick={() => setIsAdding(true)}
              className="btn btn-sm btn-primary gap-1"
            >
              <Plus size={14} /> Add Provider
            </button>
          )}
        </div>

        {isAdding || editingId ? (
          <form
            onSubmit={handleSubmit}
            className="space-y-4 bg-base-200 p-4 rounded-lg"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="form-control">
                <label className="label text-xs font-bold uppercase opacity-60">
                  Name
                </label>
                <input
                  required
                  value={formData.name || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  className="input input-bordered input-sm"
                  placeholder="My GPT-4o"
                />
              </div>
              <div className="form-control">
                <label className="label text-xs font-bold uppercase opacity-60">
                  Type
                </label>
                <select
                  value={formData.type || "openai"}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      type: e.target.value as ManagedAiProvider["type"],
                    })
                  }
                  className="select select-bordered select-sm"
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="google">Google Gemini</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="workers-ai">Cloudflare Workers AI</option>
                </select>
              </div>
              <div className="form-control md:col-span-2">
                <label className="label text-xs font-bold uppercase opacity-60">
                  API Key
                </label>
                <input
                  type="password"
                  required={!editingId}
                  value={formData.apiKey || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, apiKey: e.target.value })
                  }
                  className="input input-bordered input-sm"
                  placeholder="sk-..."
                />
              </div>
              <div className="form-control">
                <label className="label text-xs font-bold uppercase opacity-60">
                  Endpoint (Optional)
                </label>
                <input
                  value={formData.endpoint || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, endpoint: e.target.value })
                  }
                  className="input input-bordered input-sm"
                  placeholder="https://api.openai.com/v1"
                />
              </div>
              <div className="form-control">
                <label className="label text-xs font-bold uppercase opacity-60">
                  Default Model ID
                </label>
                <input
                  value={formData.modelId || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, modelId: e.target.value })
                  }
                  className="input input-bordered input-sm"
                  placeholder="gpt-4o"
                />
              </div>
            </div>
            <div className="flex justify-between gap-2 mt-4">
              <div>
                {editingId && (
                  <button
                    type="button"
                    onClick={handleFetchModels}
                    disabled={fetchingModels}
                    className="btn btn-sm btn-ghost gap-2"
                  >
                    <RefreshCw
                      size={14}
                      className={fetchingModels ? "animate-spin" : ""}
                    />
                    Fetch Models
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={resetForm}
                  className="btn btn-sm btn-ghost"
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-sm btn-primary">
                  {editingId ? "Update" : "Create"} Provider
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-sm w-full">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Model</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {providers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center py-4 opacity-50">
                      No providers configured.
                    </td>
                  </tr>
                ) : (
                  providers.map((p: ManagedAiProvider) => (
                    <tr key={p.id}>
                      <td className="font-medium">{p.name}</td>
                      <td>
                        <span className="badge badge-sm badge-outline">
                          {p.type}
                        </span>
                      </td>
                      <td className="font-mono text-xs opacity-70">
                        {p.modelId || "default"}
                      </td>
                      <td className="text-right space-x-1">
                        <button
                          onClick={() => handleEdit(p)}
                          className="btn btn-ghost btn-xs btn-square"
                        >
                          <Edit2 size={12} />
                        </button>
                        <button
                          onClick={() => deleteMut.mutate(p.id)}
                          className="btn btn-ghost btn-xs btn-square text-error"
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
