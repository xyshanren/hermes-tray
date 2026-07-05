// v0.2-alpha-8 — PersonaModal (Preact JSX).
//
// Manages three views inside the existing <div id="persona-modal">
// overlay root:
//   - list:   rows of personas with edit/delete actions + a "+ new" toolbar
//   - create: empty form for new persona
//   - edit:   form pre-filled from the persona being edited
//
// Personas are loaded via invoke('persona_list') on first open + after
// every CRUD. The header picker in main.ts is refreshed through the
// `onPersonasChanged` callback so it stays in sync without us touching
// its module-level state.

import { useEffect, useState } from "preact/hooks";
import { invoke } from "@tauri-apps/api/core";
import type { Persona } from "../types";
import { showToast } from "../lib/toast";
import { escapeHtml } from "../lib/sanitize";
import { personaStore } from "./persona-modal-store";

interface PersonaModalProps {
  /** Called after every CRUD so main.ts can refresh the header picker. */
  onPersonasChanged: () => void;
}

export function PersonaModal({ onPersonasChanged }: PersonaModalProps) {
  const [storeState, setStoreState] = useState(personaStore.get());
  const [personas, setPersonas] = useState<Persona[]>([]);

  // Subscribe to the store. Fire-on-subscribe means a fresh mount gets
  // the current state synchronously, even before the effect's microtask
  // flush completes.
  useEffect(() => personaStore.subscribe(setStoreState), []);

  // Load personas on first open. Re-loads are triggered by the CRUD
  // handlers below after a successful operation.
  useEffect(() => {
    if (storeState.open && personas.length === 0) {
      void loadPersonas();
    }
  }, [storeState.open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadPersonas(): Promise<void> {
    try {
      const list = await invoke<Persona[]>("persona_list");
      setPersonas(list);
      onPersonasChanged();
    } catch (e) {
      showToast("加载 Persona 失败", String(e), "error");
    }
  }

  async function handleDelete(id: string): Promise<void> {
    try {
      await invoke("persona_delete", { id });
      await loadPersonas();
      personaStore.setMode("list");
      personaStore.setEditingId(null);
      showToast("已删除", "", "success");
    } catch (e) {
      showToast("删除失败", String(e), "error");
    }
  }

  async function handleSave(input: {
    name: string;
    description: string;
    system_prompt: string;
    avatar: string;
    model: string | null;
  }): Promise<void> {
    if (!input.name) {
      showToast("请填写名称", "", "error");
      return;
    }
    if (!input.system_prompt) {
      showToast("请填写系统提示词", "", "error");
      return;
    }
    try {
      if (storeState.mode === "edit" && storeState.editingId) {
        const existing = personas.find((p) => p.id === storeState.editingId);
        if (!existing) {
          showToast("编辑失败", "找不到原始 Persona", "error");
          return;
        }
        const updated: Persona = {
          ...existing,
          ...input,
        };
        await invoke<Persona>("persona_update", { persona: updated });
        await loadPersonas();
        personaStore.setMode("list");
        personaStore.setEditingId(null);
        showToast("已更新", updated.name, "success");
      } else {
        const now = Date.now().toString();
        const id = `persona:${crypto.randomUUID()}`;
        const created: Persona = {
          id,
          name: input.name,
          description: input.description,
          system_prompt: input.system_prompt,
          avatar: input.avatar,
          model: input.model,
          created_at: now,
          updated_at: now,
          is_builtin: 0,
        };
        await invoke<Persona>("persona_create", { persona: created });
        await loadPersonas();
        personaStore.setMode("list");
        personaStore.setEditingId(null);
        showToast("已创建", created.name, "success");
      }
    } catch (e) {
      showToast(
        storeState.mode === "edit" ? "更新 Persona 失败" : "创建 Persona 失败",
        String(e),
        "error",
      );
    }
  }

  if (!storeState.open) return null;

  const editingPersona =
    storeState.mode === "edit" && storeState.editingId
      ? personas.find((p) => p.id === storeState.editingId) ?? null
      : null;

  return (
    <div class="modal modal-persona">
      <div class="modal-header">
        <h2>👤 Persona 库</h2>
        <button
          class="modal-close-btn"
          aria-label="关闭 Persona 库"
          onClick={() => personaStore.close()}
        >
          ×
        </button>
      </div>
      <div class="modal-body">
        {storeState.mode === "list" && (
          <PersonaList
            personas={personas}
            onNew={() => personaStore.setMode("create")}
            onEdit={(id) => {
              personaStore.setEditingId(id);
              personaStore.setMode("edit");
            }}
            onDelete={(id) => void handleDelete(id)}
          />
        )}
        {(storeState.mode === "create" || storeState.mode === "edit") && (
          <PersonaForm
            persona={editingPersona}
            onCancel={() => {
              personaStore.setMode("list");
              personaStore.setEditingId(null);
            }}
            onSave={handleSave}
          />
        )}
      </div>
    </div>
  );
}

// ── List view ────────────────────────────────────────────────────────────────

interface PersonaListProps {
  personas: Persona[];
  onNew: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

function PersonaList({ personas, onNew, onEdit, onDelete }: PersonaListProps) {
  return (
    <>
      <div class="persona-toolbar">
        <button type="button" class="btn btn-primary" onClick={onNew}>
          + 新建 Persona
        </button>
      </div>
      <div class="persona-list">
        {personas.length === 0 ? (
          <div class="persona-empty">暂无 Persona</div>
        ) : (
          personas.map((p) => {
            const builtin = p.is_builtin === 1;
            const promptPreview = (p.system_prompt || "").slice(0, 120);
            const promptSuffix = (p.system_prompt || "").length > 120 ? "…" : "";
            return (
              <div class="persona-row" key={p.id} data-id={escapeHtml(p.id)}>
                <div class="persona-avatar">{escapeHtml(p.avatar || "👤")}</div>
                <div class="persona-info">
                  <div class="persona-name">
                    {escapeHtml(p.name)}
                    {builtin ? (
                      <span class="persona-tag builtin">内置</span>
                    ) : null}
                  </div>
                  <div class="persona-desc">
                    {escapeHtml(p.description || "(无描述)")}
                  </div>
                  <div class="persona-prompt-preview">
                    {escapeHtml(promptPreview)}
                    {promptSuffix}
                  </div>
                </div>
                <div class="persona-actions">
                  {builtin ? null : (
                    <>
                      <button
                        type="button"
                        class="persona-action-btn"
                        onClick={() => onEdit(p.id)}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        class="persona-action-btn danger"
                        onClick={() => {
                          if (confirm(`确定删除 Persona "${p.name}"？`)) {
                            void onDelete(p.id);
                          }
                        }}
                      >
                        删除
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

// ── Form view (create + edit) ──────────────────────────────────────────────

interface PersonaFormProps {
  persona: Persona | null;
  onCancel: () => void;
  onSave: (input: {
    name: string;
    description: string;
    system_prompt: string;
    avatar: string;
    model: string | null;
  }) => Promise<void>;
}

function PersonaForm({ persona, onCancel, onSave }: PersonaFormProps) {
  const isEdit = persona !== null;
  const builtin = isEdit && persona!.is_builtin === 1;
  const [name, setName] = useState(isEdit ? persona!.name : "");
  const [desc, setDesc] = useState(isEdit ? persona!.description ?? "" : "");
  const [prompt, setPrompt] = useState(isEdit ? persona!.system_prompt : "");
  const [avatar, setAvatar] = useState(isEdit ? persona!.avatar || "👤" : "👤");
  const [model, setModel] = useState(isEdit ? persona!.model ?? "" : "");

  return (
    <div class="persona-form">
      <div class="form-group">
        <label>头像 (Emoji)</label>
        <input
          type="text"
          maxLength={4}
          value={avatar}
          disabled={builtin}
          title={builtin ? "内置 Persona 不可修改" : undefined}
          onInput={(e) => setAvatar((e.currentTarget as HTMLInputElement).value)}
        />
      </div>
      <div class="form-group">
        <label>名称 *</label>
        <input
          type="text"
          maxLength={60}
          value={name}
          disabled={builtin}
          title={builtin ? "内置 Persona 不可修改" : undefined}
          onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
        />
      </div>
      <div class="form-group">
        <label>简介</label>
        <input
          type="text"
          maxLength={200}
          value={desc}
          placeholder="一句话描述这个角色"
          onInput={(e) => setDesc((e.currentTarget as HTMLInputElement).value)}
        />
      </div>
      <div class="form-group">
        <label>系统提示词 *</label>
        <textarea
          rows={8}
          placeholder="定义助手的角色、风格、约束..."
          value={prompt}
          onInput={(e) =>
            setPrompt((e.currentTarget as HTMLTextAreaElement).value)
          }
        />
        <span class="form-hint">每次新建会话时自动注入到 system 消息</span>
      </div>
      <div class="form-group">
        <label>绑定 Model (T-Q-S12-light)</label>
        <input
          type="text"
          maxLength={80}
          value={model}
          placeholder="例如 gpt-4o-mini / deepseek-chat (留空 = 用默认)"
          onInput={(e) => setModel((e.currentTarget as HTMLInputElement).value)}
        />
        <span class="form-hint">
          选这个 Persona 时, 对话会用这个 model 名发请求. 留空则用全局默认.
        </span>
      </div>
      <div class="persona-form-actions">
        <button type="button" class="btn btn-secondary" onClick={onCancel}>
          返回
        </button>
        <button
          type="button"
          class="btn btn-primary"
          onClick={() =>
            void onSave({
              name: name.trim(),
              description: desc.trim(),
              system_prompt: prompt.trim(),
              avatar: avatar.trim() || "👤",
              model: model.trim().length > 0 ? model.trim() : null,
            })
          }
        >
          {isEdit ? "保存" : "创建"}
        </button>
      </div>
    </div>
  );
}