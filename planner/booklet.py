from pypdf import PdfReader, PdfWriter, PageObject, Transformation
r = PdfReader("SFF-2026-Pack3721-Maps.pdf"); P = r.pages
W, H = 792, 1224
sides = [(8, True, 1), (2, False, 7), (6, False, 3), (4, False, 5)]
w = PdfWriter()
for top, rot, bot in sides:
    pg = PageObject.create_blank_page(width=W, height=H)
    pg.merge_transformed_page(P[bot - 1], Transformation())
    t = Transformation().rotate(180).translate(W, 612 + 612) if rot else Transformation().translate(0, 612)
    pg.merge_transformed_page(P[top - 1], t)
    w.add_page(pg)
for p in w.pages: p.compress_content_streams(level=9)
w.compress_identical_objects(remove_duplicates=True, remove_unreferenced=True)
w.write("SFF-2026-Pack3721-Maps-Booklet-Tabloid.pdf")
