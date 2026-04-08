## Mathematical Output Presentation (Project Standard)

This project renders answers in the browser using **Marked** (Markdown) and **KaTeX** (math).

### Output contract (backend)

Backend responses now include:
- **`display_markdown`**: a render-ready Markdown string (preferred for UI)
- plus the existing structured fields like `final_answer`, `steps`, and `llm_steps`

### Formatting rules

- **Use Markdown headings** for structure:
  - `### Result`, `### Final answer`, `### Steps`, `### Diagnostics`
- **Inline math**: wrap math-looking fragments in KaTeX inline delimiters:
  - `\\( x = 3 \\)`
- **Avoid heavy “auto-LaTeX”** transformations.
  - Prefer small, predictable formatting over risky conversions.
- **Steps**
  - If `llm_steps` exists: render as bullet list with **Step N — Title**, then “Math” + “Why”.
  - Otherwise: render engine `steps` as a numbered list.

### UI integration tip

In the frontend, prefer `display_markdown` when present:

```js
// If backend returns { display_markdown }, render it:
element.innerHTML = marked.parse(display_markdown);
// KaTeX is already applied in existing UI formatting pipeline.
```

## Agent System Reference (Best Practices)

This repository contains two orchestration styles:
- **Direct pipeline**: `backend/app.py::route_and_solve` (simple, fast, minimal moving parts)
- **Agent graph**: `backend/agent.py` (LangGraph orchestration, tool wrappers, richer control)

### Recommended agent design patterns

- **Tool wrappers are thin**
  - Tools should call existing engines/LLM methods, not re-implement math logic.
- **Typed state**
  - Keep a single state object (`AgentState`) with stable keys.
- **Deterministic fallbacks**
  - If LLM is unavailable, fall back to local engines with heuristic input cleanup.
- **Separation of concerns**
  - Classification → parsing → solving → presentation should be independent modules.
- **Observability**
  - Log branch selection, parse failures, engine failures, and elapsed time.

### Error handling & debugging checklist

- **LLM not working**
  - Confirm `GROQ_API_KEY` is set
  - Check model name (`GROQ_MODEL`) and provider availability
- **Math engine fails to parse**
  - Remove directive prefixes (“solve”, “differentiate”) or rely on the heuristic cleanup
  - Prefer explicit math input (e.g. `2*x + 5 = 11`)
- **CORS issues**
  - Add your frontend domain to `ALLOWED_ORIGINS` (comma-separated)
- **OCR / vision issues**
  - Confirm `SCOUT_API_KEY` is set
  - Validate frontend is sending `image_data` as a data URL

