#!/usr/bin/env python3
"""The Escape check skips expand/collapse disclosures (aria-expanded, no aria-haspopup).

Walk 3 filed every sidebar "Expand <lens> sub-lenses" toggle as "Escape doesn't
close the menu/panel". Those buttons show a list inline; they aren't overlays,
so Escape isn't required to close them. Pins checks.is_disclosure with AX nodes
shaped the way Chrome reports them (verified against Chromium's
Accessibility.getFullAXTree: aria-haspopup is `hasPopup`, omitted when "false"),
plus the real control: every case that opens an overlay is still checked.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from concord_walker.checks import is_disclosure
from concord_walker.cdp import AXNode


def node(role, name, **props):
    return AXNode({"nodeId": "1", "backendDOMNodeId": 1, "role": {"value": role}, "name": {"value": name},
                   "properties": [{"name": k, "value": {"value": v}} for k, v in props.items()]})


FAILS = []


def check(label, ok):
    print(("PASS " if ok else "FAIL ") + label)
    if not ok:
        FAILS.append(label)


sidebar = node("button", "Expand Chat sub-lenses", expanded=True)
accordion = node("button", "Show details", expanded=True)
menu_btn = node("button", "Export", hasPopup="menu", expanded=True)
dialog_btn = node("button", "Settings", hasPopup="dialog", expanded=True)
true_btn = node("button", "More", hasPopup="true", expanded=True)
menu = node("menu", "Export")
dialog = node("dialog", "New note")

check("sidebar sub-lens expander is a disclosure", is_disclosure(sidebar, None))
check("accordion toggle is a disclosure", is_disclosure(accordion, None))
check("aria-haspopup=menu button with no menu found is still checked", not is_disclosure(menu_btn, None))
check("aria-haspopup=dialog button is still checked", not is_disclosure(dialog_btn, None))
check("aria-haspopup=true button is still checked", not is_disclosure(true_btn, None))
check("expander that opened a real menu is still checked", not is_disclosure(sidebar, menu))
check("button that opened a dialog is still checked", not is_disclosure(accordion, dialog))
check("missing opener node with no popup is treated as a disclosure", is_disclosure(None, None))

sys.exit(1 if FAILS else 0)
