const { getDb } = require('../server/db');
const { initZaloBot } = require('../server/zaloService');

async function run() {
  const db = await getDb();
  const groupSetting = await db.get("SELECT value FROM settings WHERE key = 'zalo_target_group_id'");
  const targetGroupId = groupSetting ? groupSetting.value : null;

  if (!targetGroupId) {
    console.error("Chưa cấu hình nhóm Zalo đích trong settings!");
    process.exit(1);
  }

  const api = await initZaloBot();
  if (!api) {
    console.error("Bot chưa login!");
    process.exit(1);
  }

  const ids = targetGroupId.split(',').map(id => id.trim()).filter(Boolean);
  console.log("Danh sách nhóm cần test thành viên:", ids);

  for (const gid of ids) {
    console.log(`\n========================================`);
    console.log(`Đang lấy thông tin nhóm: ${gid}`);
    try {
      const gInfo = await api.getGroupInfo(gid);
      const gridInfo = gInfo?.gridInfoMap?.[gid];
      const memList = gridInfo?.memVerList || [];
      console.log(`Nhóm "${gridInfo?.name || ''}" có ${memList.length} thành viên.`);
      
      if (memList.length > 0) {
        // Lấy danh sách UID
        const uids = memList.map(item => {
          if (typeof item === 'string') {
            return item.split('_')[0];
          } else if (item && typeof item === 'object') {
            return Object.keys(item)[0];
          }
          return String(item);
        }).filter(Boolean);

        console.log(`Trích xuất được ${uids.length} UIDs. Đang lấy thông tin chi tiết của các thành viên...`);

        const chunkSize = 50;
        let allMembersInfo = {};
        for (let i = 0; i < uids.length && i < 150; i += chunkSize) {
          const chunk = uids.slice(i, i + chunkSize);
          const membersInfo = await api.getGroupMembersInfo(chunk);
          if (membersInfo) {
            // Xem cấu trúc membersInfo trả về
            // ZCA SDK: getGroupMembersInfo trả về map uid -> profile object
            allMembersInfo = { ...allMembersInfo, ...membersInfo };
          }
        }

        console.log("Kết quả lấy thông tin thành viên (mẫu 5 người):");
        const keys = Object.keys(allMembersInfo);
        console.log(`Lấy thành công thông tin của ${keys.length} thành viên.`);
        
        keys.slice(0, 5).forEach(key => {
          const member = allMembersInfo[key];
          console.log(`- UID: ${key} | Name: ${member?.displayName || member?.name || member?.zaloName || 'Không tên'}`);
        });
      }
    } catch (err) {
      console.error(`Lỗi xử lý nhóm ${gid}:`, err.message);
    }
  }

  process.exit(0);
}

run();
