# WhatsApp Chat Viewer (React)

This is a local React frontend to view WhatsApp exported chats from a `.txt` file and show the attachments (images / PDFs / audio / video) that are **already in the same export folder**.

## Run

```bash
cd "c:\Users\user\AppData\Local\Packages\5319275A.WhatsAppDesktop_cv1g1gvanyjgm\LocalState\sessions\24AE0785C979F3D4CF6C594A8B365E1F716565A8\transfers\2026-17\WhatsApp Chat - SAQR DALIY ADVANCE\chat-viewer"
npm install
npm run dev
```

## Use

1. **Load chat**: pick your exported `_chat.txt`
2. **Pick export folder**: pick the folder that contains attachment files like `00011941-PHOTO-....jpg`
3. Use the left panel to **choose a name** and **filter/search**.

Notes:
- The browser needs you to select the folder so it can access the local files (security rule).
- The message list display is capped at 2,000 rows for performance; use filters/search to narrow down.

