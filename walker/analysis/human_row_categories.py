exec(open("/Users/dutch/.zuko/walker/analysis/fold_and_classify_fpv.py").read().split("# --- simulate")[0].replace('print(','(lambda *a,**k:None)('))
H2 = [
 ("payments_money", r"\b(stripe|checkout|purchase|buy(ing)?|payout|withdraw|wallet|sparks|concord coin|royalt|refund|billing|subscription|payments?|pay)\b|\bcharged?\b"),
 ("cross_account_privacy", r"other user|another user|someone else|foreign|cross.?account|\bleaks?\b|\bleak(ed|ing)\b|not (the )?owner|owner.?(check|scop)|owner's|privacy|private (to|data|thread|message)|visible to|unauthori|\b403\b|non.admin|information exposure|any user|all users|other users|raw user uuid|\bt2\b"),
 ("hidden_text_or_test_data", r"hidden (ai|text)|ai.directed|addressed to ai|test.?harness|harness|test data|fixture data|lorem|placeholder text|seed(ed)? data|demo data|sample data|dummy"),
 ("realtime_socket", r"socket|real.?time|live update|presence|collaborat|websocket|\bsse\b|multiplayer|spectat|broadcast|\bpush\b|other tab|second tab|without (a )?reload|until reload"),
 ("audio_daw", r"\baudio|sound|playback|\bplay(s|ing|er)?\b|music|\bbeat|waveform|mixer|\bdaw\b|\bmp3|\bwav\b|synth|volume|tempo|\bbpm\b|metronome|midi|instrument|\bsong|vocal|\btts\b|speech|voice"),
 ("3d_webgl_canvas_map", r"\b3d\b|webgl|three\.?js|canvas|\bscene\b|\bmesh|\bglb\b|\bgltf|camera|orbit|globe|\bmap\b|draw(ing)?\b|stroke|pixel|sketch|whiteboard|animat|chart|graph (view|render)|scatter|plot"),
 ("file_upload_media", r"upload|attach|image|photo|picture|file picker|drag|drop zone|\bpdf\b|thumbnail|avatar|\bcsv import|import (a |the )?file"),
 ("email_oauth_external_api", r"\bemail|oauth|google|github|sign.?in with|verification (link|code)|\bsms\b|two.factor|2fa|\botp\b|webhook|third.party|api key|external|fetch failed|lookup failed|sketchfab|weather|airport lookup|\bnoaa|\bfaa\b|openai|provider"),
 ("missing_control_or_crud", r"\bno (edit|delete|rename|search|filter|sort|detail|create|undo|way to|pagination|export|import|back)\b|can.?t be (renamed|edited|deleted)|cannot be (edited|renamed|deleted)|can.?t (rename|edit|delete)|only delete|has no (edit|delete|sort|search|filter|create|detail)|no (in-lens )?search|missing (edit|delete|search|filter|sort|control|button)|not editable|read.only"),
 ("validation_messages", r"validat|invalid|required|negative|out of range|accepts?|silently (clamp|accept|drop)|refus|reject|future.dated|before (start|issued|etd)|blank form|empty (submit|name|title|form)|whitespace|\bnan\b|bad input|malformed|\{bad|-\d|999"),
 ("llm_ai_output", r"\bai\b|\bllm|\bmodel\b|generat|\bbrain|hallucinat|\banswer|replies|reply|summar|prompt|\bagent|conkay|\bask about|canned|handler_error|chat"),
 ("computed_or_displayed_value", r"total|\bsum\b|\bcount|calculat|wrong|mismatch|round(ing|ed)|percent|average|score|metric|statistic|one day earlier|off by|minus sign|shows the previous|returns 0|\b0 (phases|groups|results|items)|ignores selected|time ?zone|date (shows|is)|appends? to existing"),
 ("persistence_readback", r"\bsave[sd]?\b|persist|reload|\blost\b|vanish|disappear|refresh|read.?back|history|not findable|doesn.t appear|never appears"),
 ("dead_click_fake_success", r"does nothing|no.?op|dead (button|click|control)|nothing happens|\bfake\b|\bstub|hard.?coded|\bmock|toast|success (but|message|toast)|pretend|returns to|instead of|doesn.t (switch|work|open|respond)|no response|no feedback|silent(ly)?"),
 ("keyboard_a11y", r"arrow|keyboard|heading order|\ba11y|aria|screen reader|tab order|focus"),
 ("visual_layout_copy", r"layout|overlap|align|spacing|clutter|design|looks|\bicon|empty.state|label|wording|copy|text (says|reads)|typo|truncat|font|colou?r|theme|dark mode|tooltip|badge|breaks apart|sentence|described as|says|title|heading|mobile|390|scroll"),
]
NONLENS = re.compile(r"^(HV|HV60|SB|IDLE|GB|CB|MA|LC|CC|CK|CR|REG|INC)-", re.I)
def h2(rid, t):
    if NONLENS.match(rid) or not t.get("lens"): return "non_lens_code_ticket"
    T = txt(t).lower()
    for n,p in H2:
        if re.search(p,T): return n
    return "other_unclear"
def elements(t):
    T = txt(t)
    names = re.findall(r"(?<![A-Za-z])'([^']{2,40})'(?![A-Za-z])|\"([^\"]{2,40})\"|\u2018([^\u2019]{2,40})\u2019|\u201c([^\u201d]{2,40})\u201d", T)
    return [next(x for x in n if x) for n in names]
pool=[]; wr=[]
for r in out:
    t=base.get(r["id"],{}); c=r["walker_class"] or None; T=txt(t); el=elements(t)
    if c in ("delete_confirm","persistence","hotkey"): bucket="needs_write"
    elif c is None: bucket="free_text"
    elif c in ("escape","focus_return","focus_trap","tab_error") and not el: bucket="no_named_element"
    elif c=="overflow390" and not (el or re.search(r"horizontal|sideways|scrolls? (left|right)|overflow",T,re.I)): bucket="visual_390"
    elif c=="timing" and not (re.search("load",T,re.I) and not el): bucket="interaction_timing"
    elif c in ("unnamed","keyboard","focus_visible") and el: bucket="named_a11y"
    elif c in ("http","pageerror"): bucket="never_fixed_console"
    else: bucket="walker_decides"
    r["today_bucket"]=bucket; r["human_category"]=h2(r["id"],t)
    if bucket not in ("walker_decides",): pool.append(r)
C=collections.Counter(r["human_category"] for r in pool if r["today_bucket"] not in("needs_write",))
B=collections.Counter(r["today_bucket"] for r in out)
print("today buckets:",dict(B.most_common()))
hp=[r for r in pool if r["today_bucket"]!="needs_write"]
print("human-judgment pool (excl needs_write):",len(hp)); 
for k,v in C.most_common(): print("  ",v,k)
print("needs_write by category:",dict(collections.Counter(r["human_category"] for r in pool if r["today_bucket"]=="needs_write").most_common()))
import random; random.seed(3)
oth=[r for r in hp if r["human_category"]=="other_unclear"]
for r in random.sample(oth,min(25,len(oth))): print("U",r["id"],"|",r["title"][:120])
f=open("/Users/dutch/.zuko/walker/analysis/FPV-ROWS-CLASSIFIED-20261114.csv","w"); w=csv.DictWriter(f,fieldnames=["id","lens","severity","walker_class","today_bucket","human_category","title"]); w.writeheader(); w.writerows(sorted(out,key=lambda r:(r["today_bucket"],r["human_category"],r["id"]))); f.close()
