#!/usr/bin/env python3
# ============================================================
#  scripts/make-estimate-template.py
#  会社の見積Excel → 「空テンプレ＋仕込み済み」を作る（会社ごとに1回だけ）
#
#  使い方:
#    python3 scripts/make-estimate-template.py <元のExcel> <出力先.xlsx>
#
#  ★何をするか
#   1) 明細（名称/形状/寸法/数量/単位/原価）を全部空にする
#   2) 手打ちだった単価を数式(=Y{行})へ戻す
#      （空テンプレなのに前の案件の 3400 が残るため）
#   3) 案件固有の色（場所見出しの黄色など）を落とす
#      ★B列には場所・工種・作業内容が雑多に入る運用なので、
#       特定の案件でたまたま付いた色が残ると誤解を招く
#   4) 単価表シート・候補表シートを足し、ドロップダウンを仕込む
#
#  ★ドロップダウンの範囲は「実データぴったり」でなければならない。
#   Excel の入力補完（打ち込むと候補が絞り込まれる機能）は、
#   空白セルを含む範囲だと効かない。実測:
#     単価表!$A$2:$A$10  （9件ぴったり）→ 効く
#     候補表!$A$2:$A$500 （472件が空白）→ 効かない
#   そこで OFFSET+COUNTA で埋まっている行数ぶんだけを指す。
#
#  ★1セルに付けられる入力規則は1つだけ。
#   場所・工種・作業内容を別々のドロップダウンにするとファイルが壊れるため、
#   候補表に1本化してある（（）と ■ で種類は見分けられる）。
#
#  ★実行後は必ず Excel で開いて修復ダイアログが出ないことを確かめること。
#   openpyxl は画像・図形と [Content_Types].xml の Default宣言を落とすので、
#   scripts/xlsx_restore.py（save_with_drawings）で復元している。
# ============================================================
import sys, os, re, zipfile
import xml.etree.ElementTree as ET

import openpyxl
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import quote_sheetname
from openpyxl.styles import Font, PatternFill, Alignment

RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'

# ── フォーマット定義（apps/admin/src/lib/estimateExcel.ts の SEED_FORMAT と対にすること）──
MAIN_SHEET = '全体見積'
FIRST_ROW, LAST_ROW = 3, 107
CLEAR_COLS = [2, 3, 4, 5, 6, 11, 14, 15, 16]      # B名称 C形状 D/E/F寸法 K備考 N数量 O単位 P原価
UNIT_PRICE_COL = 9                                 # I列＝見積単価（=Y{行}）
VENDOR_COL, VENDOR_COL_LETTER = 12, 'L'            # 発注先（印刷範囲の外）
TRADE_SHEETS = [
    '仮設工事', '解体工事 (2)', '軽鉄工事 (3)', '壁面表装工事 (4)', '床表装工事 (5)',
    '塗装工事 (6)', '造作工事 (7)', '什器工事 (8)', '建具工事 (9)', '金物工事',
    '左官工事 (11)', 'タイル工事 (13)', 'ガラス工事 (12)', 'サイン工事 (13)',
    '電気工事 (14)', '空調工事 (15)', '給排水衛生工事 (16)', '施工管理 (17)', '諸経費工事 (18)',
]
TRADE_FIRST, TRADE_LAST = 3, 26
LOCATIONS = ['（壁面工事）', '（天井工事）', '（床工事）', '（什器工事）', '（共通）']
TRADES = ['■仮設工事', '■解体工事', '■軽鉄工事', '■壁面表装工事', '■床表装工事', '■塗装工事',
          '■造作工事', '■什器工事', '■建具工事', '■金物工事', '■左官工事', '■タイル工事',
          '■ガラス工事', '■サイン工事', '■電気工事', '■空調工事', '■給排水衛生工事',
          '■施工管理', '■諸経費']
MAX = 500   # 単価表・候補表の走査上限


def clear_body(wb):
    """明細を空にし、手打ちの単価を数式へ戻し、案件固有の色を落とす。"""
    cleared = fills = 0
    ws = wb[MAIN_SHEET]
    for r in range(FIRST_ROW, LAST_ROW + 1):
        for c in CLEAR_COLS:
            if ws.cell(r, c).value is not None:
                ws.cell(r, c).value = None
                cleared += 1
        ws.cell(r, UNIT_PRICE_COL).value = f'=Y{r}'
        # ★案件固有の塗り（場所見出しの黄色・メモの緑）を落とす。
        #  B列には場所/工種/作業内容が雑多に入るため、色が残ると意味を持って見えてしまう。
        cell = ws.cell(r, 2)
        if cell.fill and cell.fill.patternType:
            cell.fill = PatternFill(fill_type=None)
            fills += 1
    for name in TRADE_SHEETS:
        if name not in wb.sheetnames:
            continue
        w = wb[name]
        for r in range(TRADE_FIRST, TRADE_LAST + 1):
            for c in CLEAR_COLS:
                if w.cell(r, c).value is not None:
                    w.cell(r, c).value = None
                    cleared += 1
            w.cell(r, UNIT_PRICE_COL).value = f'=Y{r}'
    return cleared, fills


def add_sheets(wb):
    """単価表・候補表を作る（中身はアプリが毎回書き込む）。"""
    for s in ('単価表', '候補表', '分類表'):
        if s in wb.sheetnames:
            del wb[s]

    m = wb.create_sheet('単価表')
    m.append(['作業内容', '原価', '業者', '提示日', '選択肢の表示'])
    m['G1'] = '※アプリが書き出します。手で編集しないでください（作業内容の昇順・同じ作業内容の中は安い順である必要があります）'
    m['G1'].font = Font(size=8, color='888888')
    for col, wd in [('A', 26), ('C', 16), ('E', 34)]:
        m.column_dimensions[col].width = wd

    k = wb.create_sheet('候補表')
    k.append(['名称の候補'])
    k['C1'] = '※場所（（）付き）・工種（■付き）・作業内容を1本にまとめた候補。1セルに入力規則は1つしか付けられないため'
    k['C1'].font = Font(size=8, color='888888')
    k.column_dimensions['A'].width = 30
    for v in LOCATIONS + TRADES:
        k.append([v])
    return len(LOCATIONS) + len(TRADES)


def add_validations(wb):
    ws = wb[MAIN_SHEET]
    S, K = quote_sheetname('単価表'), quote_sheetname('候補表')

    # ★名称：埋まっている行数ぶんだけを指す。空白を含むと入力補完が効かない。
    name_src = f'=OFFSET({K}!$A$2,0,0,MAX(1,COUNTA({K}!$A$2:$A${MAX})),1)'
    d_name = DataValidation(type='list', formula1=name_src, allow_blank=True)
    d_name.showErrorMessage = False      # 候補に無い作業も打てるようにする
    d_name.showInputMessage = True
    d_name.promptTitle = '名称'
    d_name.prompt = '打ち込むと候補が絞り込まれます。（）は場所、■は工種、それ以外は作業内容です'
    ws.add_data_validation(d_name)

    h = ws.cell(2, VENDOR_COL)
    h.value = '発注先（業者・単価・提示日）'
    h.font = Font(name='MS Mincho', size=9, bold=True, color='2C4C6B')
    h.fill = PatternFill('solid', fgColor='EAF0F5')
    h.alignment = Alignment(horizontal='center')
    ws.cell(1, VENDOR_COL).value = '↓この列は印刷されません'
    ws.cell(1, VENDOR_COL).font = Font(name='MS Mincho', size=7, color='888888')
    ws.column_dimensions[VENDOR_COL_LETTER].width = 34

    for r in range(FIRST_ROW, LAST_ROW + 1):
        d_name.add(ws.cell(r, 2))
        # ★名称が選ばれていない行では候補を空にする（単価表!$G$3 は常に空のセル）。
        #  Excelの入力規則はセルごとに静的なので矢印自体は消せないが、
        #  無関係な業者名が並ぶのは防げる。
        cnt = f'COUNTIF({S}!$A$2:$A${MAX},B{r})'
        src = (f'=IF({cnt}=0,{S}!$G$3,'
               f'OFFSET({S}!$E$2,MATCH(B{r},{S}!$A$2:$A${MAX},0)-1,0,{cnt},1))')
        dv = DataValidation(type='list', formula1=src, allow_blank=True)
        dv.showErrorMessage = False
        dv.showInputMessage = True
        dv.promptTitle = '発注先'
        dv.prompt = '業者・単価・提示日を安い順に比べて選べます'
        ws.add_data_validation(dv)
        dv.add(ws.cell(r, VENDOR_COL))
        # ★該当なしの戻り値を "" にしてはいけない。
        #  この値は X→Y(=X/0.8)→I→J と数式で伝播するため、空文字だと
        #  「文字の割り算」になって全行が #VALUE! になる（実際に踏んだ）。
        #  0 を返し、表示は書式（0を非表示）で空に見せる。
        ws.cell(r, 16).value = (
            f'=IFERROR(INDEX({S}!$B$2:$B${MAX},MATCH(L{r},{S}!$E$2:$E${MAX},0)),0)')
        # 0 を空に見せる（正;負;ゼロ;文字 の3番目を空にする）
        for col in (9, 10, 16):          # I単価 / J金額 / P単価原価
            ws.cell(r, col).number_format = '#,##0;-#,##0;;@'


# ── openpyxl が落とす画像・図形を復元する ────────────────────
def _sheetmap(zf):
    wbx = ET.fromstring(zf.read('xl/workbook.xml'))
    rl = ET.fromstring(zf.read('xl/_rels/workbook.xml.rels'))
    idm = {r.get('Id'): r.get('Target') for r in rl}
    out = {}
    for s in wbx.find(f'{{{MAIN}}}sheets'):
        t = idm.get(s.get(f'{{{RNS}}}id'))
        if t:
            out[s.get('name')] = 'xl/' + t.lstrip('/').replace('xl/', '', 1)
    return out


def save_with_drawings(wb, src, out):
    tmp = out + '.tmp'
    wb.save(tmp)
    zs, zt = zipfile.ZipFile(src), zipfile.ZipFile(tmp)
    ms, mt = _sheetmap(zs), _sheetmap(zt)
    holders = {}
    for name, sp in ms.items():
        rel = f'xl/worksheets/_rels/{sp.split("/")[-1]}.rels'
        if rel in zs.namelist() and 'drawing' in zs.read(rel).decode('utf8') and name in mt:
            holders[name] = (rel, mt[name])
    parts = [p for p in zs.namelist() if p.startswith(('xl/drawings/', 'xl/media/'))]
    src_ct = zs.read('[Content_Types].xml').decode('utf8')
    exts = {os.path.splitext(p)[1].lstrip('.').lower() for p in parts if p.startswith('xl/media/')}
    # ★この Default 宣言が1行でも欠けると Excel が「修復または削除」を要求する
    defaults = [m for e in exts
                for m in re.findall(rf'<Default[^>]*Extension="{e}"[^>]*/>', src_ct, re.I)]

    written = set()
    zw = zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED)
    for item in zt.infolist():
        data = zt.read(item.filename)
        for name, (rel, tp) in holders.items():
            if item.filename == tp and b'<drawing' not in data:
                if b'xmlns:r=' not in data:
                    data = re.sub(rb'(<worksheet\b[^>]*)', rb'\1 xmlns:r="' + RNS.encode() + rb'"',
                                  data, count=1)
                data = data.replace(b'</worksheet>', b'<drawing r:id="rIdDraw"/></worksheet>')
        if item.filename == '[Content_Types].xml':
            ct = data.decode('utf8')
            add = ''.join(d for d in defaults if d not in ct)
            add += ''.join(
                f'<Override PartName="/{p}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
                for p in parts if p.startswith('xl/drawings/') and p.endswith('.xml')
                and f'PartName="/{p}"' not in ct)
            data = (ct.replace('</Types>', add + '</Types>')).encode('utf8')
        zw.writestr(item, data)
        written.add(item.filename)
    for p in parts:
        if p not in written:
            zw.writestr(p, zs.read(p))
            written.add(p)
    for name, (rel, tp) in holders.items():
        target = f'xl/worksheets/_rels/{tp.split("/")[-1]}.rels'
        if target not in written:
            zw.writestr(target, re.sub(r'Id="rId\d+"', 'Id="rIdDraw"',
                                       zs.read(rel).decode('utf8')))
    zw.close()
    os.remove(tmp)


def validate(path):
    """Excel が弾く典型パターンを潰す。"""
    z = zipfile.ZipFile(path)
    names = set(z.namelist())
    errs = []
    ct = z.read('[Content_Types].xml').decode('utf8')
    defaults = {m.lower() for m in re.findall(r'<Default[^>]*Extension="([^"]+)"', ct, re.I)}
    overrides = set(re.findall(r'<Override[^>]*PartName="/([^"]+)"', ct))
    for n in names:
        if n.endswith('/') or n == '[Content_Types].xml' or n.endswith('.rels'):
            continue
        ext = os.path.splitext(n)[1].lstrip('.').lower()
        if n not in overrides and ext not in defaults:
            errs.append(f'Content-Type未宣言: {n}')
    for n in [x for x in names if x.endswith('.rels')]:
        base = os.path.dirname(os.path.dirname(n))
        for t in re.findall(r'Target="([^"]+)"', z.read(n).decode('utf8')):
            if t.startswith('http') or '://' in t:
                continue
            p = (t.lstrip('/') if t.startswith('/')
                 else os.path.normpath(os.path.join(base, t)).replace('\\', '/'))
            if p not in names:
                errs.append(f'rel参照先が無い: {n} -> {t}')
    # ★1セルに複数の入力規則が付くとファイルが壊れる
    for n in [x for x in names if x.startswith('xl/worksheets/sheet') and x.endswith('.xml')]:
        x = z.read(n).decode('utf8')
        seen = {}
        for m in re.finditer(r'<dataValidation\b[^>]*sqref="([^"]+)"', x):
            for tok in m.group(1).split():
                seen[tok] = seen.get(tok, 0) + 1
        dup = [c for c, k in seen.items() if k > 1]
        if dup:
            errs.append(f'1セルに複数の入力規則: {n} {dup[:5]}')
    return errs


def main():
    if len(sys.argv) < 3:
        print(__doc__ or '', file=sys.stderr)
        print('usage: make-estimate-template.py <元のExcel> <出力先.xlsx>', file=sys.stderr)
        sys.exit(2)
    src, out = sys.argv[1], sys.argv[2]
    wb = openpyxl.load_workbook(src)
    for need in (MAIN_SHEET,):
        if need not in wb.sheetnames:
            print(f'「{need}」シートがありません: {src}', file=sys.stderr)
            sys.exit(1)
    cleared, fills = clear_body(wb)
    base = add_sheets(wb)
    add_validations(wb)
    save_with_drawings(wb, src, out)
    errs = validate(out)
    print(f'空にしたセル: {cleared} / 落とした塗り: {fills} / 候補の初期件数: {base}')
    print('検証:', '問題なし' if not errs else errs)
    if errs:
        sys.exit(1)


if __name__ == '__main__':
    main()
