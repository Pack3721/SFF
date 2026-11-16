"""Builds the den leader guides: app/guide/week1.html and week2.html, linked from the map's Settings > About.

    python3 tools/guide/build.py

Screenshots live in app/guide/img/ (w1-*.jpg, w2-*.jpg). Text uses **bold**. The ?v=dev on the stylesheet
and screenshots becomes the git SHA when pages.yml deploys (cache busting), as for the map.
"""
import html, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "..", "..", "app")

WEEK1 = {
    "title": "Den leader guide: Week 1 (bags)",
    "lead": "Split your den into walking groups, then give each group a QR code. About five minutes.",
    "sections": [
        ("1. Open den leader mode", [
            "Pick **Den leader** from the den menu at the top.",
            "First check the dispatcher’s number is in ⚙ **Settings → Texting**, so the QR codes carry it."], []),
        ("2. Split", [
            "- **− / +** sets the number of groups. The app splits the den for you, keeping each group’s segments close together.",
            "- To move a segment: tap a group’s **colour**, then tap the segment on the map.",
            "- **Auto re-split** undoes your moves.",
            "- Type over a group’s name with the name the dispatcher knows. Texts start with it: “Wk1: Wolf A – W7 done”."],
            ["w1-leader.jpg"]),
        ("3. Hand out", [
            "**QR code button:** a parent scans it with the phone’s camera.",
            "**Segment list button:** for families on the paper map. Read out the segment codes so they can mark them.",
            "**Print handouts for all groups:** one page per group: the whole den map with the group’s segments starred, a box to tick by each segment, how to text the dispatcher, and the group’s QR code. (From an iPhone Home Screen app, Print gives you a link to open in Safari; print from there.)"],
            ["w1-handout-buttons.jpg", "w1-qr.jpg", "w1-list.jpg"]),
        ("A printed handout", [], ["w1-handout.jpg"]),
        ("What parents see", [
            "**Pick a segment.** Swipe the box at the top left or right. The target gets moving white dashes on the map."],
            ["w1-target.jpg"]),
        (None, [
            "**Get there, then mark it done.** Tap the box to open the segment’s card: **Directions ›** for driving directions, and **Done** once it’s walked, which texts the dispatcher."],
            ["w1-card.jpg"]),
        (None, [
            "**See where you are.** Tap the crosshair. The blue dot follows you, and the wedge shows which way you’re facing."],
            ["w1-gps.jpg"]),
        (None, [
            "**Text or call the dispatcher** with the speech-bubble button. **Needs coverage…** lets you tap the segments your group can’t get to, then sends one text."],
            ["w1-dispatcher.jpg", "w1-coverage.jpg"]),
        (None, [
            "**All done.** Tap the green box and say how many bags are left."],
            ["w1-alldone.jpg"]),
        ("Tips", [
            "- **Make the groups that morning.** You never know who will show up, or which scouts want to buddy up that day.",
            "- Finish the split before handing out codes. Moving a segment later means new codes.",
            "- Low turnout, and the load looks too big? Add an extra group and name it **Needs coverage**. The split gives it a fair share like any group. Screenshot its list and send it to the dispatcher to hand out. Do this before handing out codes, since + re-splits the whole den.",
            "- ⚠ main-road segments go to older scouts, or scouts closely watched by an adult. Cross Baptist Church Rd at the Kingsmere all-way stop.",
            "- **More than one parent tracking the group?** Keep one texter per group: the others turn off **Settings → Texting → Text the dispatcher when I tap Done**. Their Done then just marks the segment.",
            "- **Walking with a group yourself, or using the iPhone Home Screen app?** Settings → **Group** → **Scan QR code**, and scan the group’s code.",
            "- No dispatcher number in the QR? Add it in Settings → Texting, then reopen the QR."],
            ["w1-settings-texting.jpg", "w1-settings-group.jpg"]),
    ],
}

WEEK2 = {
    "title": "Den leader guide: Week 2 (pickup)",
    "lead": "Week 2 turns on by itself on the day. Everyone starts with nothing marked done, and picks up by car.",
    "sections": [
        ("1. Keep or re-split your groups", [
            "- **Same groups as last week?** Do nothing. Parents’ phones already have their segments.",
            "- **Re-splitting for cars?** Open **Den leader**, set the number of groups and tap **Auto re-split**. Week 2 splits into car loops and keeps both sides of a street together.",
            "- Then hand out the new QR codes, as in Week 1."],
            ["w2-leader.jpg"]),
        ("2. Hand out", [
            "**QR code** and **segment list** buttons work as in Week 1.",
            "**Print handouts for all groups:** one page per group: the whole den map with the group’s segments starred, a line by each segment to tally bags, how to text the dispatcher, and the group’s QR code."],
            ["w2-handout-buttons.jpg"]),
        ("A printed handout", [], ["w2-handout.jpg"]),
        ("What parents do", [
            "**Count bags as they go.** On the segment’s card, tap **+** for each bag of food. **Done** texts the dispatcher with the count: “Wk2: Wolf A – W2 done, 3 bags”. No count? It asks about how many."],
            ["w2-card.jpg"]),
        (None, [
            "**Swipe the box** to change target. After **Done**, the app picks the nearest unfinished segment if the phone knows where it is."],
            ["w2-target.jpg", "w2-gps.jpg"]),
        (None, [
            "**Can’t get to some?** Speech-bubble button → **Needs coverage…** → tap the segments on the map → **Text**. They’re crossed out on the group’s list."],
            ["w2-dispatcher.jpg", "w2-coverage.jpg"]),
        (None, [
            "**All done? Optional second pass first.** For bags put out late, tap the green box, then **Optional second pass**, and drive your segments again. The box says **2nd pass**, the tally keeps adding, and Done only texts the dispatcher when a segment has new bags: \u201cWk2: Wolf A \u2013 W6 second pass, 2 more bags\u201d."],
            ["w2-pass2.jpg"]),
        (None, [
            "**Then the drop-off.** Tap the green box: **Directions** to Fire Station 5 (11020 Mueller Rd) for the bags of food texts the dispatcher \u201cheading to Fire Station 5\u201d, then opens the directions. (With auto-texting off, it\u2019s a separate **Text heading there** button, like Text done.) Or **Available to help** to take more segments. Tap the fire station on the map for its address."],
            ["w2-alldone.jpg"]),
        ("Tips", [
            "- **More than one parent tracking the group?** Keep one texter per group: the others turn off **Settings → Texting → Text the dispatcher when I tap Done**. Their Done then just marks the segment.",
            "- **Setting up a phone, or the iPhone Home Screen app?** Settings → **Group** → **Scan QR code**, and scan the group’s code.",
            "- Take the bags of food to Fire Station 5 when you’re finished, or whenever the car fills up.",
            "- Last week’s ticks don’t carry over. Last week’s starred segments do, until a new QR code is scanned."],
            ["w2-settings-texting.jpg", "w2-settings-group.jpg"]),
    ],
}

def inline(t):
    t = html.escape(t, quote=False)
    return re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)

def page(g, other):
    out = ['<!doctype html>', '<html lang="en">', '<head>', '<meta charset="utf-8">',
           '<meta name="viewport" content="width=device-width, initial-scale=1">',
           '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; img-src \'self\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">',
           '<meta name="referrer" content="no-referrer">',
           f'<title>{html.escape(g["title"])} – SFF 721 Map</title>', '<link rel="stylesheet" href="guide.css?v=dev">', '</head>', '<body>',
           '<nav class="top"><a href="../">‹ Back to the map</a>' + f'<a href="{other[0]}">{html.escape(other[1])} ›</a></nav>',
           f'<h1>{html.escape(g["title"])}</h1>', f'<p class="lead">{inline(g["lead"])}</p>']
    parents = next((h for h, _, _ in g["sections"] if h and h.startswith("What parents")), None)
    if parents: out.append(f'<p class="jump"><a href="#parents">Jump to {html.escape(parents.lower())} \u2193</a></p>')
    for head, paras, imgs in g["sections"]:
        out.append('<section class="step">')
        if head:
            anchor = ' id="parents"' if head.startswith("What parents") else ""
            out.append(f'<h2{anchor}>{html.escape(head)}</h2>')
        out.append('<div class="body"><div class="text">')
        bullets = [p for p in paras if p.startswith("- ")]
        for p in paras:
            if p.startswith("> "):
                out.append(f'<aside class="quick"><span>Quick entry</span><code>{html.escape(p[2:])}</code></aside>')
            elif not p.startswith("- "): out.append(f'<p>{inline(p)}</p>')
        if bullets: out.append('<ul>' + "".join(f'<li>{inline(b[2:])}</li>' for b in bullets) + '</ul>')
        out.append('</div>')
        if imgs:
            wide = any("handout.jpg" in i or i in ("d-board.jpg", "d-map.jpg") for i in imgs)
            out.append(f'<div class="shots{" wide" if wide else ""}">' + "".join(
                f'<a href="img/{i}?v=dev"><img src="img/{i}?v=dev" alt="" loading="lazy"></a>' for i in imgs) + '</div>')
        out.append('</div></section>')
    out += ['<p class="foot">Pack 721 Scouting for Food • SFF 721 Map</p>', '</body>', '</html>', '']
    return "\n".join(out)

DISPATCH = {
    "title": "Dispatcher guide",
    "lead": "The dispatcher\u2019s board: record what the texts say, see the whole pack at a glance, and share the results. Best on a computer; it works on a phone too.",
    "sections": [
        ("1. Open the board", [
            "In the map\u2019s den menu, pick **Dispatcher** (the last choice). Or open **pack3721.github.io/SFF/?dispatch**.",
            "The whole pack\u2019s map is on the left and the board on the right (on a phone, the board is below the map). It\u2019s Week 1 or Week 2 by the date."],
            ["d-board.jpg"]),
        ("2. Entering texts", [
            "Two ways, both fine; use either or mix them. **In the grid** (tabular entry): under the box, every segment by den, like a spreadsheet. **Quick entry**: type a short code in the box at the top and press Enter. Each step below shows both.",
            "Copied a text from the app? Paste it into the quick entry box; it\u2019s read the same way."],
            ["d-grid.jpg"]),
        ("A segment is done", [
            "**In the grid:** set its **Status** to **Done**.",
            "> W6"],
            []),
        ("Bags (Week 2)", [
            "**In the grid:** type the count in **Bags**. That marks it done too.",
            "> W6 5"],
            []),
        ("Second pass bags (Week 2)", [
            "**In the grid:** type them in **2nd**, next to Bags.",
            "> W6 +2"],
            []),
        ("Needs coverage", [
            "**In the grid:** set its **Status** to **Coverage**.",
            "> W12!"],
            []),
        ("Which group", [
            "**In the grid:** type the name in **Group**. Names already used are offered as you type. Any capitals are fine: wolf b is Wolf B.",
            "> W6 5 #Wolf B",
            "In quick entry, #Wolf B goes after any of the others; start the name and the ones already used pop up, and Tab picks the first."],
            []),
        ("Clear a mistake", [
            "**In the grid:** set **Status** back to **\u2013** and empty its Bags and Group. **Undo last entry** (under the box) takes back the last change either way.",
            "> W6--"],
            []),
        ("Several at once", [
            "**In the grid:** one row at a time; filter by den or status at the top to find them quickly. Hover a row to see when it was entered.",
            "> W10 5, W11!, W12"],
            []),
        (None, [
            "**Quick entry checks first.** An unknown code is turned down, and if W10 already has bags it asks **Replace / Add / Cancel**. (In the grid, what you type is what it saves.)"],
            ["d-ask.jpg"]),
        ("3. The map", [
            "Grey until done, then the den\u2019s colour with the bags on the label. **Needs coverage** with no group yet has the moving white dashes, so it stands out until someone takes it. Click a segment to put its code in the quick entry box and highlight its row."],
            ["d-map.jpg"]),
        ("Sending someone to cover", [
            "When W12 needs coverage, find a group with time and text them. **In the grid:** type their name in W12\u2019s **Group**; the dashes stop. When they finish, set **Status** to Done (or type the Bags).",
            "> W12 #Wolf B   then   W12 4",
            "Wolf B adds W12 on their phone with **Add by ID** on the Mine tab."],
            []),
        ("4. Groups", [
            "Built from the group names you type; nothing to set up. Each group\u2019s den comes from the segments it was given. \u201c2 of ~19\u201d is about how many: the den\u2019s segments less what its other groups have finished, firming up as the den gets done. Segments a group was sent to cover are red. Segments done with no group name sit in **Unlabeled** rows until you add one."],
            ["d-groups.jpg"]),
        ("5. Share and export", [
            "- **Share picture:** **Progress** for the pack\u2019s group chat during the walk, **Finished** for social media. Wide or square. **Save picture**, or **Share\u2026** on a phone.",
            "- **Excel:** a Dens sheet with totals and a Segments sheet.",
            "- **Backup:** everything is saved only in this browser. **Save backup** now and then, and **Restore\u2026** it on another computer if you switch."],
            ["d-export.jpg"]),
        ("Tips", [
            "- Use one computer for the whole walk. A backup moves it to another.",
            "- Texts come in late or out of order; just type them as they arrive. The time saved is when you typed it, not when it was walked.",
            "- Week 2 bags: the app adds the count to the Done text (\u201cW6 done, 5 bags\u201d), so **W6 5** is all you need.",
            "- On a phone the board sits under the map; drag the map to see the rest."],
            ["d-phone.jpg"]),
    ],
}

if __name__ == "__main__":
    open(os.path.join(APP, "guide", "week1.html"), "w").write(page(WEEK1, ("week2.html", "Week 2 guide")))
    open(os.path.join(APP, "guide", "week2.html"), "w").write(page(WEEK2, ("week1.html", "Week 1 guide")))
    open(os.path.join(APP, "guide", "dispatcher.html"), "w").write(page(DISPATCH, ("week2.html", "Den leader guide")))
    print("built")
