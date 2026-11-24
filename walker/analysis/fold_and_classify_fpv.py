import sys, json, re, csv, collections, importlib.util
sys.path.insert(0, "/Users/dutch/.zuko/walker")
spec = importlib.util.spec_from_file_location("fc", "/Users/dutch/.zuko/quality/bin/folded-count.py"); fc = importlib.util.module_from_spec(spec); spec.loader.exec_module(fc)
from concord_walker.tickets import CATEGORY_WORDS
ORDER = ["crash","hotkey","delete_confirm","escape","focus_return","focus_trap","focus_visible","export","contrast","overflow390","unnamed","keyboard","timing","tab_error","reach","pageerror","http","persistence"]
REPO="/Users/dutch/concord vs code/concord-cognitive-engine"
rows, meta = fc.load_from_ref(REPO, "origin/fix/audit-sweep-20261110")
folded, _ = fc.fold_tickets(rows)
base = {}
for r in rows:
    i = r.get("id")
    if not i: continue
    b = base.setdefault(i, {})
    for k in ("lens","title","actual","expected","repro_steps","root_cause","severity"):
        if r.get(k) and not b.get(k): b[k] = r[k]
def txt(t):
    rs = t.get("repro_steps"); rs = " ".join(map(str,rs)) if isinstance(rs, list) else (rs or "")
    return " ".join(str(t.get(k) or "") for k in ("title","actual","expected")) + " " + str(rs)
def classify(t):
    T = txt(t).lower(); ti = (t.get("title") or "").lower()
    for scope in (ti, T):
        for c in ORDER:
            if re.search(CATEGORY_WORDS[c], scope): return c
    return None
HCAT = [
 ("payments_money", r"\b(stripe|checkout|purchase|buy(ing)?|payout|withdraw|wallet|sparks|concord coin|royalt|refund|charge[ds]?|billing|subscription|pay(ment)?s?)\b"),
 ("cross_account_privacy", r"other user|another user|someone else|foreign|cross.?account|\bleak|not (the )?owner|owner.?(check|scop)|private|privacy|visib(le|ility) to|unauthori|\b403\b|permission|\bt2\b|other account|any user|all users"),
 ("realtime_socket", r"socket|real.?time|live update|presence|collaborat|websocket|\bsse\b|stream(ing)?|multiplayer|spectat|other tab|broadcast|push notif"),
 ("audio_daw", r"\baudio|sound|playback|\bplay(s|ing)? |music|beat|waveform|mixer|\bdaw\b|\bmp3|\bwav\b|synth|volume|tempo|\bbpm\b|metronome|midi|instrument|record(ing)? "),
 ("3d_webgl_canvas", r"\b3d\b|webgl|three|canvas|scene|\bmesh|\bglb\b|viewport|camera|orbit|globe|render(s|ed|ing)? (the )?(model|map)|\bmap\b|draw(ing)?|stroke|pixel"),
 ("file_upload_media", r"upload|attach|image|photo|picture|file picker|drag|drop zone|\bpdf\b|thumbnail|avatar"),
 ("email_oauth_external", r"\bemail|oauth|google|github|sign.?in with|verification (link|code)|\bsms\b|two.factor|2fa|\botp\b|webhook|third.party|api key|external (api|service)"),
 ("llm_ai_quality", r"\bai\b|\bllm|model|generat|brain|hallucinat|answer|reply|response (quality|text)|summar|prompt|agent|conkay|chat"),
 ("validation_messages", r"validat|invalid|required|negative|out of range|accepts?|silently (clamp|accept|drop)|refus|reject|future.dated|before (start|issued)|empty (submit|name|title)|\bnan\b|bad input|malformed"),
 ("computed_values", r"total|\bsum\b|count|calculat|wrong (number|value|total)|mismatch|round(ing|ed)|percent|average|score|metric|stat(s|istic)"),
 ("persistence_readback", r"save|persist|reload|lost|vanish|disappear|refresh|store|read.?back|history"),
 ("dead_click_fake_success", r"does nothing|no.?op|dead (button|click|control)|nothing happens|fake|stub|placeholder|hard.?coded|mock|toast|success (but|message)|pretend|demo data|seed data|sample data"),
 ("visual_layout_copy", r"layout|overlap|align|spacing|cluttered|design|looks|icon|empty state|label|wording|copy|text (says|reads)|typo|truncat|font|color|colour|theme|dark mode|hidden text|tooltip|badge|button (is|appears)"),
]
def hcat(t):
    T = txt(t).lower()
    for n, p in HCAT:
        if re.search(p, T): return n
    return "other_unclear"
out=[]; wc=collections.Counter(); hc=collections.Counter(); hc_all=collections.Counter(); lens_hc=collections.defaultdict(collections.Counter)
for i, f in folded.items():
    st = (f.get("status") or "").upper()
    if st != "FIXED_PENDING_VERIFY": continue
    t = base.get(i, {})
    c = classify(t); wc[c or "FREE_TEXT"] += 1
    h = hcat(t)
    hc_all[h]+=1
    if not c: hc[h] += 1
    out.append({"id": i, "lens": t.get("lens"), "severity": f.get("severity") or t.get("severity"), "walker_class": c or "", "human_category": h, "title": (t.get("title") or "")[:200]})
print("FPV", len(out)); print("walker classes:", dict(wc.most_common()))
print("free-text by human category:", dict(hc.most_common())); print("ALL FPV by category:", dict(hc_all.most_common()))
w = csv.DictWriter(open("/tmp/fpv_rows.csv","w"), fieldnames=list(out[0].keys())); w.writeheader(); w.writerows(sorted(out, key=lambda r:(r["walker_class"]!="", r["human_category"], r["id"])))
json.dump({"meta":meta}, open("/tmp/fpv_meta.json","w"))

# --- simulate today's walker outcome (read-only, no browser): which rows can it even decide?
def elements(t):
    T = txt(t)
    names = re.findall(r"(?<![A-Za-z])'([^']{2,40})'(?![A-Za-z])|\"([^\"]{2,40})\"|\u2018([^\u2019]{2,40})\u2019|\u201c([^\u201d]{2,40})\u201d", T)
    return [next(x for x in n if x) for n in names]
sim = collections.Counter(); weak = collections.Counter()
for r in out:
    t = base.get(r["id"], {}); c = r["walker_class"] or None; T = txt(t); el = elements(t)
    if not c: k = "HUMAN:free_text"
    elif c in ("delete_confirm","persistence","hotkey"): k = "HUMAN_unless_allow_write:"+c
    elif c in ("http","pageerror"): k = "STILL_or_HUMAN(never FIXED):"+c
    elif c in ("escape","focus_return","focus_trap","tab_error"): k = ("decidable_if_named_element_found:" if el else "HUMAN:no_named_element:")+c
    elif c == "overflow390": k = "decidable:overflow390" if (el or re.search(r"horizontal|sideways|scrolls? (left|right)|overflow",T,re.I)) else "HUMAN:visual_390"
    elif c == "contrast": k = "decidable:contrast_hex" if re.search(r"#[0-9a-fA-F]{6}",T) else "decidable_WEAK:contrast_main_view_only"
    elif c == "export": k = "decidable_WEAK:export_download_only(no content check)"
    elif c in ("unnamed","keyboard","focus_visible"): k = "HUMAN:named_element" if el else "decidable_WEAK:main_view_only:"+c
    elif c == "timing": k = "decidable:load_timing" if (re.search("load",T,re.I) and not el) else "HUMAN:interaction_timing"
    elif c == "reach": k = "decidable_WEAK:page_loads"
    elif c == "crash": k = "decidable:crash_loop"
    else: k = "other:"+c
    sim[k] += 1
print("\nSIMULATED today-walker outcome buckets:")
for k,v in sorted(sim.items(), key=lambda x:-x[1]): print(" ", v, k)
