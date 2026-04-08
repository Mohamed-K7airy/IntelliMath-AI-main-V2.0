"""
Sphinx-SCA — LangGraph Agent Layer
==================================
An orchestrator agent that sits ON TOP of the existing system.
Wraps LLMManager and math engines into tools without reimplementing logic.
"""

import os
import sys
import logging
from typing import TypedDict, Literal, Optional, Any
from typing_extensions import Annotated

# ─────────────────────────────────────────────
# PATH FIX FOR DIRECT EXECUTION
# ─────────────────────────────────────────────
# Add project root to sys.path when running directly
if __name__ == "__main__" and __package__ is None:
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if project_root not in sys.path:
        sys.path.insert(0, project_root)

# ─────────────────────────────────────────────
# EXISTING SYSTEM IMPORTS (DO NOT MODIFY)
# ─────────────────────────────────────────────

from backend.llm_manager import LLMManager
from backend.app import run_solver, algebra_solve, calculus_solve, geometry_solve, statistics_solve, linear_algebra_solve

logger = logging.getLogger("sphinx-agent")

# Initialize LLM Manager
llm = LLMManager()

# ─────────────────────────────────────────────
# LANGGRAPH IMPORTS
# ─────────────────────────────────────────────

from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages


# ─────────────────────────────────────────────
# STATE DEFINITION
# ─────────────────────────────────────────────

class AgentState(TypedDict):
    """
    State that flows through the graph.
    """
    # Input
    question: str
    history: list
    mode: str
    image_data: Optional[str]

    # Classification
    branch: str
    problem_type: str
    is_math: bool
    confidence: float

    # Parsed
    parsed: dict

    # Solution
    solver_result: dict

    # Steps
    steps: list

    # Output
    final_answer: str
    success: bool
    error: Optional[str]


# ─────────────────────────────────────────────
# TOOL WRAPPERS (NO LOGIC IMPLEMENTATION)
# ─────────────────────────────────────────────

def classify_tool(question: str) -> dict:
    """
    Tool wrapper for LLMManager.classify.
    Returns classification result.
    """
    try:
        result = llm.classify(question)
        return {
            "branch": result.get("branch", "algebra"),
            "problem_type": result.get("problem_type", "solve"),
            "is_math": result.get("is_math", True),
            "confidence": result.get("confidence", 0.5)
        }
    except Exception as e:
        logger.warning(f"Classification failed: {e}")
        return {
            "branch": "algebra",
            "problem_type": "solve",
            "is_math": True,
            "confidence": 0.5
        }


def parse_tool(question: str, branch: str) -> dict:
    """
    Tool wrapper for LLMManager.parse.
    Returns parsed problem data.
    """
    try:
        return llm.parse(question, branch)
    except Exception as e:
        logger.warning(f"Parse failed: {e}")
        return {}


def solver_tool(branch: str, parsed: dict, question: str) -> dict:
    """
    Tool wrapper for math engines.
    Calls appropriate engine based on branch.
    """
    solver_map = {
        "algebra": algebra_solve,
        "calculus": calculus_solve,
        "geometry": geometry_solve,
        "statistics": statistics_solve,
        "linear_algebra": linear_algebra_solve,
    }

    solver_fn = solver_map.get(branch)

    if solver_fn is None:
        return {"success": False, "error": f"Unknown branch: {branch}"}

    # Extract parameters based on branch
    try:
        if branch == "algebra":
            expr = parsed.get("expression", question)
            return run_solver(solver_fn, expr)

        elif branch == "calculus":
            expr = parsed.get("expression", question)
            return run_solver(solver_fn, expr)

        elif branch == "geometry":
            shape = parsed.get("shape")
            find = parsed.get("find")
            known = parsed.get("known", {})
            return run_solver(solver_fn, shape, find, **known)

        elif branch == "statistics":
            data = parsed.get("data", [])
            op = parsed.get("operation", "mean")
            return run_solver(solver_fn, op, data=data)

        elif branch == "linear_algebra":
            matrix = parsed.get("matrix_a")
            op = parsed.get("operation", "determinant")
            return run_solver(solver_fn, op, matrix=matrix)

        else:
            return {"success": False, "error": f"Unsupported branch: {branch}"}

    except Exception as e:
        logger.error(f"Solver error: {e}")
        return {"success": False, "error": str(e)}


def step_generator_tool(question: str, solution: str, branch: str) -> list:
    """
    Tool wrapper for LLMManager.steps.
    Generates educational steps.
    """
    try:
        return llm.steps(question, solution, branch)
    except Exception as e:
        logger.warning(f"Steps generation failed: {e}")
        return []


def hint_generator_tool(question: str, problem_type: str, num_hints: int = 3) -> list:
    """
    Tool wrapper for LLMManager.hints.
    Generates progressive hints.
    """
    try:
        return llm.hints(question, problem_type, num_hints)
    except Exception as e:
        logger.warning(f"Hints generation failed: {e}")
        return []


def chat_tool(message: str, history: list = None) -> str:
    """
    Tool wrapper for LLMManager.chat.
    Handles non-math conversations.
    """
    if history is None:
        history = []
    try:
        return llm.chat(message, history)
    except Exception as e:
        logger.error(f"Chat error: {e}")
        return f"Sorry, I encountered an error: {str(e)}"


def word_problem_tool(question: str) -> dict:
    """
    Tool wrapper for LLMManager.word_problem.
    Handles word problems.
    """
    try:
        return llm.word_problem(question)
    except Exception as e:
        logger.error(f"Word problem error: {e}")
        return {"success": False, "error": str(e)}


# ─────────────────────────────────────────────
# NODE IMPLEMENTATIONS
# ─────────────────────────────────────────────

def classifier_node(state: AgentState) -> dict:
    """
    Classify user input to determine branch.
    """
    question = state["question"]
    mode = state.get("mode", "general")

    # Modify question based on mode
    if mode == "think":
        question = f"[Think Deeply and Explain Thoroughly] {question}"
    elif mode == "steps":
        question = f"[Provide detailed step-by-step solution] {question}"

    classification = classify_tool(question)

    return {
        "branch": classification["branch"],
        "problem_type": classification["problem_type"],
        "is_math": classification["is_math"],
        "confidence": classification["confidence"]
    }


def decision_node(state: AgentState) -> str:
    """
    Decide the next node based on classification.
    Returns the edge name for routing.
    """
    is_math = state.get("is_math", True)
    branch = state.get("branch", "algebra")

    if not is_math or branch == "chat":
        return "chat"

    if branch == "word_problem":
        return "word_problem"

    return "math"


def parse_node(state: AgentState) -> dict:
    """
    Parse the math problem.
    """
    question = state["question"]
    branch = state["branch"]

    parsed = parse_tool(question, branch)

    return {"parsed": parsed}


def solver_node(state: AgentState) -> dict:
    """
    Execute the appropriate solver.
    """
    branch = state["branch"]
    parsed = state.get("parsed", {})
    question = state["question"]

    result = solver_tool(branch, parsed, question)

    return {"solver_result": result}


def word_problem_node(state: AgentState) -> dict:
    """
    Handle word problems using LLM.
    """
    question = state["question"]

    result = word_problem_tool(question)

    if result.get("answer_sentence"):
        return {
            "solver_result": {
                "success": True,
                "final_answer": result.get("answer_sentence")
            },
            "steps": result.get("steps", [])
        }

    return {
        "solver_result": {"success": False, "error": "Failed to solve word problem"}
    }


def chat_node(state: AgentState) -> dict:
    """
    Handle chat (non-math) interactions.
    """
    question = state["question"]
    history = state.get("history", [])

    response = chat_tool(question, history)

    return {
        "success": True,
        "final_answer": response,
        "is_chat": True
    }


def step_generator_node(state: AgentState) -> dict:
    """
    Generate steps for math solution.
    """
    question = state["question"]
    branch = state["branch"]
    solver_result = state.get("solver_result", {})
    mode = state.get("mode", "general")

    if not solver_result.get("success"):
        return {"steps": []}

    final_answer = solver_result.get("final_answer", "")

    steps = step_generator_tool(question, final_answer, branch)

    return {"steps": steps}


def final_response_node(state: AgentState) -> dict:
    """
    Prepare final response structure.
    """
    solver_result = state.get("solver_result", {})
    steps = state.get("steps", [])
    branch = state.get("branch", "unknown")
    problem_type = state.get("problem_type", "unknown")
    is_math = state.get("is_math", True)
    mode = state.get("mode", "general")

    # Check if this was a chat
    if branch == "chat" or not is_math:
        return {
            "success": True,
            "final_answer": state.get("final_answer", ""),
            "branch": branch,
            "is_chat": True
        }

    # Math response
    return {
        "success": solver_result.get("success", False),
        "final_answer": solver_result.get("final_answer", ""),
        "steps": steps,
        "branch": branch,
        "problem_type": problem_type,
        "is_chat": False,
        "mode": mode,
        "error": solver_result.get("error")
    }


# ─────────────────────────────────────────────
# GRAPH BUILDER
# ─────────────────────────────────────────────

def build_agent_graph() -> StateGraph:
    """
    Build the LangGraph agent graph.

    Structure:
        User Input → Classifier → Decision → [Chat | Math Pipeline] → Final Response
    """
    graph = StateGraph(AgentState)

    # Add nodes
    graph.add_node("classifier", classifier_node)
    graph.add_node("parse", parse_node)
    graph.add_node("solver", solver_node)
    graph.add_node("word_problem", word_problem_node)
    graph.add_node("chat", chat_node)
    graph.add_node("step_generator", step_generator_node)
    graph.add_node("final_response", final_response_node)

    # Set entry point
    graph.set_entry_point("classifier")

    # Add conditional routing after classifier
    graph.add_conditional_edges(
        "classifier",
        decision_node,
        {
            "chat": "chat",
            "word_problem": "word_problem",
            "math": "parse"
        }
    )

    # Math pipeline edges
    graph.add_edge("parse", "solver")
    graph.add_edge("solver", "step_generator")

    # All paths converge to final_response
    graph.add_edge("chat", "final_response")
    graph.add_edge("word_problem", "final_response")
    graph.add_edge("step_generator", "final_response")

    # End
    graph.add_edge("final_response", END)

    return graph


# ─────────────────────────────────────────────
# AGENT CLASS (PUBLIC API)
# ─────────────────────────────────────────────

class MathAgent:
    """
    LangGraph-based Agent that orchestrates the math solving pipeline.

    Usage:
        agent = MathAgent()
        result = await agent.solve("solve 2x + 5 = 11")
    """

    def __init__(self):
        self.graph = build_agent_graph()
        self.app = self.graph.compile()

    def solve(self, question: str, history: list = None, mode: str = "general") -> dict:
        """
        Main entry point for solving problems.

        Args:
            question: User's math problem or chat message
            history: Conversation history (optional)
            mode: "general", "think", or "steps"

        Returns:
            {
                "success": bool,
                "final_answer": str,
                "steps": list,
                "branch": str,
                "is_chat": bool
            }
        """
        if history is None:
            history = []

        initial_state: AgentState = {
            "question": question,
            "history": history,
            "mode": mode,
            "image_data": None,
            "branch": "unknown",
            "problem_type": "unknown",
            "is_math": True,
            "confidence": 0.0,
            "parsed": {},
            "solver_result": {},
            "steps": [],
            "final_answer": "",
            "success": False,
            "error": None
        }

        try:
            result = self.app.invoke(initial_state)

            return {
                "success": result.get("success", False),
                "final_answer": result.get("final_answer", ""),
                "steps": result.get("steps", []),
                "branch": result.get("branch", "unknown"),
                "problem_type": result.get("problem_type", "unknown"),
                "is_chat": result.get("is_chat", False),
                "mode": result.get("mode", mode),
                "error": result.get("error")
            }

        except Exception as e:
            logger.error(f"Agent error: {e}", exc_info=True)
            return {
                "success": False,
                "error": str(e),
                "final_answer": "",
                "steps": [],
                "branch": "error"
            }

    async def solve_stream(self, question: str, history: list = None, mode: str = "general"):
        """
        Streaming version for chat-like experience.
        Yields chunks of the response.
        """
        # For streaming, delegate to LLMManager's stream_chat
        messages = []
        if history:
            for m in history:
                role = m.get('role') or ("user" if m.get("sender") == "user" else "assistant")
                content = m.get("content", "")
                if role and content:
                    messages.append({"role": role, "content": content})

        prompt = question
        if mode == "think":
            prompt = f"Please solve this and explain your deep thinking process: {question}"
        elif mode == "steps":
            prompt = f"Please provide a detailed step-by-step solution for: {question}"

        messages.append({"role": "user", "content": prompt})

        async for chunk in llm.stream_chat(messages):
            yield chunk

    def get_hints(self, question: str, problem_type: str = "algebra", num_hints: int = 3) -> dict:
        """
        Generate progressive hints without revealing the answer.
        """
        hints = hint_generator_tool(question, problem_type, num_hints)
        return {
            "success": True,
            "hints": hints
        }


# ─────────────────────────────────────────────
# SINGLETON INSTANCE
# ─────────────────────────────────────────────

# Global instance for FastAPI integration
_agent_instance = None

def get_agent() -> MathAgent:
    """
    Get or create the singleton agent instance.
    """
    global _agent_instance
    if _agent_instance is None:
        _agent_instance = MathAgent()
    return _agent_instance


# ─────────────────────────────────────────────
# FASTAPI INTEGRATION EXAMPLE
# ─────────────────────────────────────────────

"""
# Add this to backend/app.py:

from backend.agent import get_agent

@app.post("/agent_solve")
async def agent_solve(req: QuestionRequest):
    '''
    New endpoint using LangGraph agent.
    '''
    agent = get_agent()
    return agent.solve(req.question, req.history, req.mode)

@app.post("/agent_stream")
async def agent_stream(req: QuestionRequest):
    '''
    Streaming endpoint using agent.
    '''
    agent = get_agent()

    async def chunk_generator():
        async for chunk in agent.solve_stream(req.question, req.history, req.mode):
            yield f"data: {json.dumps({'content': chunk})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(chunk_generator(), media_type="text/event-stream")
"""


# ─────────────────────────────────────────────
# TEST
# ─────────────────────────────────────────────

if __name__ == "__main__":
    import json

    print("=" * 60)
    print("Testing MathAgent with LangGraph")
    print("=" * 60)

    agent = MathAgent()

    # Test 1: Math problem
    print("\n[TEST 1] Math Problem: solve 2x + 5 = 11")
    result = agent.solve("solve 2x + 5 = 11")
    print(json.dumps(result, indent=2, default=str))

    # Test 2: Chat
    print("\n[TEST 2] Chat: hi, how are you?")
    result = agent.solve("hi, how are you?")
    print(json.dumps(result, indent=2, default=str))

    # Test 3: Calculus
    print("\n[TEST 3] Calculus: differentiate x^2")
    result = agent.solve("differentiate x^2")
    print(json.dumps(result, indent=2, default=str))