#!/usr/bin/env python3
"""GB-1580 item 4: the premap sweep + surface inventory scope to the lens
main-content region — app-shell chrome (sidebar Expand/Collapse, nav, top
bar, global search) is excluded; a landmark INSIDE main is the lens's own
and stays; a page with no <main> falls back to whole-page scope, named."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from concord_walker.cdp import AXTree
from concord_walker.checks import region_scope, is_shell_chrome, in_main_region

FAILS = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + ((" " + str(extra)[:300]) if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


def N(nid, role, name="", parent=None, children=()):
    return {"nodeId": nid, "role": {"value": role}, "name": {"value": name},
            "parentId": parent, "childIds": list(children), "backendDOMNodeId": nid * 10, "ignored": False}


# page: banner(search) / complementary>navigation(sidebar) / main(own nav) / loose button
nodes = [
    N(1, "RootWebArea", "Lens", None, [2, 3, 4, 5]),
    N(2, "banner", "", 1, [6]),
    N(6, "search", "", 2, [7]),
    N(7, "button", "Global search", 6),
    N(3, "complementary", "", 1, [8]),
    N(8, "navigation", "", 3, [9, 10]),
    N(9, "button", "Expand sub-lens", 8),
    N(10, "button", "Collapse sidebar", 8),
    N(4, "main", "", 1, [11, 12, 13]),
    N(11, "button", "Play", 4),
    N(12, "navigation", "", 4, [14]),
    N(14, "tab", "Tracks", 12),
    N(13, "textbox", "Search tracks", 4),
    N(5, "button", "Floating help", 1),
]
ax = AXTree(nodes)
by_name = {n.name: n for n in ax.live() if n.name}
scope = region_scope(ax)
check("scope is 'main' when a main landmark exists", scope[0] == "main", scope)
check("lens body controls are in region", in_main_region(ax, by_name["Play"], scope) and in_main_region(ax, by_name["Search tracks"], scope))
check("a navigation INSIDE main is the lens's own (its tab stays in region)", in_main_region(ax, by_name["Tracks"], scope))
check("sidebar Expand/Collapse are shell chrome, out of region",
      is_shell_chrome(ax, by_name["Expand sub-lens"]) and not in_main_region(ax, by_name["Expand sub-lens"], scope)
      and not in_main_region(ax, by_name["Collapse sidebar"], scope))
check("top-bar global search is shell chrome, out of region",
      is_shell_chrome(ax, by_name["Global search"]) and not in_main_region(ax, by_name["Global search"], scope))
check("a control outside main and outside any landmark is out of region (not lens content)",
      not in_main_region(ax, by_name["Floating help"], scope) and not is_shell_chrome(ax, by_name["Floating help"]))

ax2 = AXTree([N(1, "RootWebArea", "Lens", None, [2]), N(2, "button", "Only", 1)])
scope2 = region_scope(ax2)
check("no main landmark -> scope 'page', everything in region (named fallback)",
      scope2 == ("page", None) and in_main_region(ax2, ax2.live()[1], scope2), scope2)

# a complementary WRAPPING main does not make main's content shell chrome
ax3 = AXTree([N(1, "RootWebArea", "Lens", None, [2]), N(2, "complementary", "", 1, [3]),
              N(3, "main", "", 2, [4]), N(4, "button", "Inner", 3)])
check("a landmark wrapping main does not exclude main's content",
      in_main_region(ax3, ax3.by_id[4], region_scope(ax3)))

print("\n%d failure(s)" % len(FAILS))
sys.exit(1 if FAILS else 0)
