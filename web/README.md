# 网站说明

**推荐统一入口**（网站 + 数据库 + Agnes）：

```powershell
cd d:\datawhale
python -m uvicorn server.app.main:app --host 127.0.0.1 --port 8000
```

打开 http://127.0.0.1:8000/  

重点展示页：http://127.0.0.1:8000/#database  

详见 [`数据库验证文档.md`](../数据库验证文档.md)。
