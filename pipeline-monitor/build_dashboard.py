from pathlib import Path

root = Path(r"C:\SiteYeb\pipeline-monitor")
template = (root / "监控面板.template.html").read_text(encoding="utf-8")
snapshot = (root / "snapshot.json").read_text(encoding="utf-8")
output = template.replace("/*__SNAPSHOT__*/", snapshot)
(root / "监控面板.html").write_text(output, encoding="utf-8")
print(root / "监控面板.html")
