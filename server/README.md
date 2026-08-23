# 后端服务（Agnes + 数据库）

```powershell
# 在仓库根目录
python -m pip install -r server\requirements.txt
python -m uvicorn server.app.main:app --host 127.0.0.1 --port 8000
```

- 验证页：http://127.0.0.1:8000/verify  
- 说明：[`数据库验证文档.md`](../数据库验证文档.md)
