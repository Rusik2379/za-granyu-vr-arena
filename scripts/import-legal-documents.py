import argparse, hashlib, html, json, re, shutil
from pathlib import Path
from docx import Document

parser = argparse.ArgumentParser()
parser.add_argument('--terms', required=True)
parser.add_argument('--privacy', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
reports = []
terms_headings = {'Правила игры', 'Ограничения к игре', 'Тарифные правила', 'Предоплата', 'Опоздания'}
for kind, source, download in [('terms', args.terms, 'user-agreement.docx'), ('privacy', args.privacy, 'personal-data-policy.docx')]:
    source = Path(source)
    doc = Document(source)
    assert not doc.tables, 'Handle tables explicitly before publishing'
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    title = paragraphs[0]
    body, toc = [], []
    for index, text in enumerate(paragraphs[1:], 1):
        heading = text in terms_headings if kind == 'terms' else bool(re.match(r'^\d+\.\s+\D', text))
        escaped = html.escape(text).replace('\n', '<br>')
        if heading:
            anchor = 'section-' + str(index)
            body.append(f'<h2 id="{anchor}">{escaped}</h2>')
            toc.append(f'<a href="#{anchor}">{escaped}</a>')
        else:
            css = ' class="legal-list-line"' if text.startswith('—') else ''
            body.append(f'<p{css}>{escaped}</p>')
    other = 'privacy' if kind == 'terms' else 'terms'
    other_title = 'Политика обработки персональных данных' if kind == 'terms' else 'Пользовательское соглашение'
    page = f'''<!doctype html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#080a10"><title>{html.escape(title)} — За Гранью</title><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/fonts.css"><link rel="stylesheet" href="/legal.css"></head><body>
<header class="legal-header"><a href="/" aria-label="За Гранью — на главную"><img src="/assets/za-granyu-logo-transparent.png" alt="За Гранью — VR-арена" width="2172" height="724"></a><a href="/#booking" class="legal-book">Записаться на игру</a></header>
<main class="legal-document"><a class="legal-back" href="/">← На главную</a><p class="legal-eyebrow">Документы VR-арены</p><h1>{html.escape(title)}</h1><div class="legal-actions"><a href="/documents/{download}" download="{html.escape(source.name)}">Скачать оригинал Word</a><a href="/{other}/">{other_title}</a></div><nav class="legal-toc" aria-label="Содержание">{''.join(toc)}</nav><article>{''.join(body)}</article><a class="legal-return" href="/#booking">Перейти к записи на игру →</a></main>
<footer class="legal-footer"><a href="/">© 2026 За Гранью</a><a href="/terms/">Пользовательское соглашение</a><a href="/privacy/">Политика обработки персональных данных</a></footer></body></html>'''
    directory = root / 'dist' / kind
    directory.mkdir(parents=True, exist_ok=True)
    (directory / 'index.html').write_text(page, encoding='utf-8')
    assets = root / 'dist/documents'
    assets.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, assets / download)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    assert hashlib.sha256((assets / download).read_bytes()).hexdigest() == digest
    reports.append({'kind': kind, 'sourceName': source.name, 'sha256': digest, 'paragraphs': len(paragraphs), 'page': f'/{kind}/', 'download': f'/documents/{download}'})
(root / 'design/legal-sources.json').write_text(json.dumps(reports, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('Published both complete documents and byte-identical Word originals.')
