"""
Python tracer for Study Lenses.

Uses sys.settrace() to capture function calls and returns.
Outputs JSON array of trace steps to stdout.
"""

import sys
import json

trace_depth = 0
trace_steps = []


def trace_function(frame, event, arg):
    """Trace function calls and returns."""
    global trace_depth

    func_name = frame.f_code.co_name
    filename = frame.f_code.co_filename

    # ONLY trace user-defined functions (filename contains 'exec', '<stdin>', or '<string>')
    if 'exec' not in filename and '<stdin>' not in filename and '<string>' not in filename:
        return trace_function

    # Skip special functions
    if func_name.startswith('_') or func_name in ['<module>', '<listcomp>']:
        return trace_function

    try:
        if event == 'call':
            args = []
            for var in frame.f_code.co_varnames[:frame.f_code.co_argcount]:
                val = frame.f_locals.get(var)
                args.append(str(val) if val is not None else 'None')

            trace_steps.append({
                'type': 'call',
                'name': func_name,
                'args': args,
                'depth': trace_depth,
                'line': frame.f_lineno
            })
            trace_depth += 1

        elif event == 'return':
            trace_depth -= 1
            ret_val = str(arg) if arg is not None else 'None'
            trace_steps.append({
                'type': 'return',
                'name': func_name,
                'value': ret_val,
                'depth': trace_depth,
                'line': frame.f_lineno
            })
    except Exception:
        pass

    return trace_function


if __name__ == '__main__':
    # Read user code from stdin
    user_code = sys.stdin.read()

    # Redirect stdout to suppress user's print statements
    import io
    original_stdout = sys.stdout
    sys.stdout = io.StringIO()

    # Enable tracing BEFORE exec
    sys.settrace(trace_function)

    try:
        # Execute user code in a namespace that will be traced
        namespace = {}
        exec(user_code, namespace)
    except Exception as e:
        # Restore stdout for error reporting
        sys.stdout = original_stdout
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        # Disable tracing
        sys.settrace(None)

        # Restore stdout
        sys.stdout = original_stdout

        # Output trace steps as JSON
        print(json.dumps(trace_steps))
