// v0.2-alpha-7 — SearchModal (Preact JSX).
//
// Renders into the existing `<div id="search-modal">` overlay root from
// index.html. The store in ./search-modal-store drives visibility; main.ts
// owns the wiring (openSearchModal/closeSearchModal, Ctrl+K, tray menu,
// sidebar button) and calls into this view via the store.

import { useEffect, useRef, useState } from "preact/hooks";
import { invoke } from "@tauri-apps/api/core";
import type { SearchHit } from "../types";
import { showToast } from "../lib/toast";
import { escapeHtml, sanitizeSnippet } from "../lib/sanitize";
import { searchModalStore } from "./search-modal-store";

interface SearchModalProps {
  /** Called when the user picks a result. main.ts handles sidebar+selectSession. */
  onSelect: (sessionId: string) => void;
}

const SEARCH_LIMIT = 20;
const DEBOUNCE_MS = 250;

// Module-level setter ref. setQuery is a stable useState setter inside the
// SearchModal closure; we expose it through this singleton so tests can
// drive it imperatively without going through Preact's input event chain.
let _setQuery: ((q: string) => void) | null = null;

export function _setSearchQuery(q: string): void {
  _setQuery?.(q);
}

export function SearchModal({ onSelect }: SearchModalProps) {
  const [open, setOpen] = useState(searchModalStore.getOpen());
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Expose the setter for tests via the module singleton.
  _setQuery = setQuery;

  // Subscribe to the open/close store.
  useEffect(() => {
    const unsub = searchModalStore.subscribe((next) => setOpen(next));
    return unsub;
  }, []);

  // Reset state + focus input only on the rising edge of `open` (false→true).
// Using a ref guard prevents the effect from re-running and clobbering
// in-flight query state on every re-render — which was breaking the
// debounce chain under Preact + happy-dom.
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setQuery("");
      setHits([]);
      setLoading(false);
      setActiveIdx(-1);
      queueMicrotask(() => inputRef.current?.focus());
    }
    prevOpenRef.current = open;
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setHits([]);
      setLoading(false);
      setActiveIdx(-1);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const results = await invoke<SearchHit[]>("session_search", {
          query: trimmed,
          limit: SEARCH_LIMIT,
        });
        if (query.trim() === trimmed) {
          setHits(results);
          setActiveIdx(results.length > 0 ? 0 : -1);
        }
      } catch (e) {
        showToast("搜索失败", String(e), "error");
        setHits([]);
        setActiveIdx(-1);
      } finally {
        if (query.trim() === trimmed) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, open]);

  // Esc closes the modal.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") searchModalStore.setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Scroll active item into view when activeIdx changes.
  useEffect(() => {
    if (activeIdx < 0 || !listRef.current) return;
    const items = listRef.current.querySelectorAll(".search-result-item");
    items[activeIdx]?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  /** Keyboard navigation: ↑↓ move, Enter selects. */
  function handleKeyDown(e: KeyboardEvent) {
    if (hits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((prev) => (prev + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((prev) => (prev <= 0 ? hits.length - 1 : prev - 1));
    } else if (e.key === "Enter" && activeIdx >= 0 && activeIdx < hits.length) {
      e.preventDefault();
      searchModalStore.setOpen(false);
      onSelect(hits[activeIdx].session_id);
    }
  }

  if (!open) return null;

  return (
    <div class="modal modal-search">
      <div class="modal-header">
        <h2>🔍 搜索会话</h2>
        <button
          class="modal-close-btn"
          aria-label="关闭搜索"
          onClick={() => searchModalStore.setOpen(false)}
        >
          ×
        </button>
      </div>
      <div class="modal-body">
        <input
          ref={inputRef}
          type="text"
          class="search-input"
          placeholder="输入关键词搜索... (↑↓ 导航, Enter 打开)"
          value={query}
          autocomplete="off"
          onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={handleKeyDown}
        />
        <div class="search-results" ref={listRef}>
          {loading && <div class="search-empty">搜索中...</div>}
          {!loading && query.trim() && hits.length === 0 && (
            <div class="search-empty">
              未找到与「{escapeHtml(query.trim())}」相关的会话
            </div>
          )}
          {!loading && hits.length > 0 && (
            <>
              <div class="search-count">{hits.length} 个结果</div>
              {hits.map((hit, idx) => (
                <div
                  class={`search-result-item${idx === activeIdx ? " active" : ""}`}
                  key={hit.session_id}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => {
                    searchModalStore.setOpen(false);
                    onSelect(hit.session_id);
                  }}
                >
                  <div class="search-result-title">
                    {hit.session_title || "无标题会话"}
                  </div>
                  <div
                    class="search-result-snippet"
                    // sanitized to allow only <b> tags from FTS5 snippet
                    dangerouslySetInnerHTML={{ __html: sanitizeSnippet(hit.snippet) }}
                  />
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}