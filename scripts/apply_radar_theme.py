from pathlib import Path
import re
link='<link rel="stylesheet" href="/radar-unified-theme.css" data-radar-unified-theme="1">'
count=0
for path in Path('public').rglob('*.html'):
    s=path.read_text(encoding='utf-8')
    if 'data-radar-unified-theme' in s: continue
    if re.search(r'</head\s*>',s,re.I):
        s=re.sub(r'</head\s*>',lambda m:link+'\n'+m.group(0),s,count=1,flags=re.I)
        path.write_text(s,encoding='utf-8')
        count+=1
print('Updated HTML dashboards:',count)
