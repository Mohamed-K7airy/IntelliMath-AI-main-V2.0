"""
backend/presentation.py

Single place to turn solver outputs into clean, renderable Markdown.

Frontend already uses Marked + KaTeX, so we emit Markdown with optional
KaTeX inline math using `\\( ... \\)`.
"""

from __future__ import annotations

from typing import Any


def _as_inline_math(s: str) -> str:
    """
    Wrap in KaTeX inline delimiters if it looks like math.
    Keep this conservative to avoid breaking normal text.
    """
    text = (s or "").strip()
    if not text:
        return ""
    looks_math = any(tok in text for tok in ("=", "^", "_", "√", "π", "→", "∞", "∫", "Σ", "det", "sin", "cos", "tan"))
    if looks_math and not (text.startswith("\\(") and text.endswith("\\)")):
        return f"\\({text}\\)"
    return text


def render_solution_markdown(
    *,
    question: str,
    result: dict[str, Any],
    branch: str | None = None,
    mode: str | None = None,
) -> str:
    """
    Render a result dict (math engine or LLM) into Markdown.
    """
    q = (question or "").strip()
    b = (branch or result.get("branch") or "unknown").strip()
    m = (mode or result.get("mode") or "general").strip()

    success = bool(result.get("success", False))
    final_answer = result.get("final_answer", "")
    err = result.get("error")

    lines: list[str] = []
    lines.append(f"### Result")
    lines.append(f"- **Branch**: `{b}`")
    lines.append(f"- **Mode**: `{m}`")
    if q:
        lines.append(f"- **Question**: {q}")
    lines.append("")

    if not success:
        lines.append("### Error")
        lines.append(f"{err or 'Unable to solve the problem.'}")
        return "\n".join(lines).strip() + "\n"

    lines.append("### Final answer")
    if isinstance(final_answer, dict):
        # Pretty-print structured answers (e.g. statistics summary)
        lines.append("```json")
        import json

        lines.append(json.dumps(final_answer, indent=2, ensure_ascii=False))
        lines.append("```")
    else:
        lines.append(f"**{_as_inline_math(str(final_answer))}**")
    lines.append("")

    # Prefer educational LLM steps when present, else engine steps.
    llm_steps = result.get("llm_steps") or []
    engine_steps = result.get("steps") or []

    if llm_steps:
        lines.append("### Steps")
        for s in llm_steps:
            try:
                step_no = s.get("step")
                title = (s.get("title") or "").strip()
                action = (s.get("action") or "").strip()
                explanation = (s.get("explanation") or "").strip()
            except Exception:
                continue

            header = f"**Step {step_no}**" if step_no is not None else "**Step**"
            if title:
                header += f" — {title}"
            lines.append(f"- {header}")
            if action:
                lines.append(f"  - **Math**: {_as_inline_math(action)}")
            if explanation:
                lines.append(f"  - **Why**: {explanation}")
        lines.append("")

    elif engine_steps:
        lines.append("### Steps")
        for i, s in enumerate(engine_steps, start=1):
            step_text = str(s).strip()
            if not step_text:
                continue
            # Keep engine steps readable; wrap obvious math fragments.
            lines.append(f"{i}. {step_text}")
        lines.append("")

    # Optional metadata for developers (kept small)
    confidence = result.get("confidence")
    if confidence is not None:
        lines.append("### Diagnostics")
        lines.append(f"- **Confidence**: `{confidence}`")

    return "\n".join(lines).strip() + "\n"


def attach_presentation_fields(
    *,
    question: str,
    result: dict[str, Any],
    branch: str | None = None,
    mode: str | None = None,
) -> dict[str, Any]:
    """
    Return a shallow copy of `result` with render-ready fields attached.
    """
    out = dict(result)
    out["display_markdown"] = render_solution_markdown(
        question=question,
        result=out,
        branch=branch,
        mode=mode,
    )
    return out

