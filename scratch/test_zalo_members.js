const { getDb } = require('../server/db');
const { initZaloBot, getBotGroups } = require('../server/zaloService');

async function run() {
  const api = await initZaloBot();
  if (!api) {
    console.error("Bot chưa login!");
    process.exit(1);
  }

  const groups = await getBotGroups();
  console.log("Danh sách nhóm:");
  console.log(groups);

  if (groups.length > 0) {
    const gid = groups[0].groupId;
    console.log(`Đang lấy thông tin nhóm: ${gid}`);
    const gInfo = await api.getGroupInfo(gid);
    
    const gridInfo = gInfo?.gridInfoMap?.[gid];
    const memList = gridInfo?.memVerList || [];
    console.log("memVerList (số lượng):", memList.length);
    if (memList.length > 0) {
      console.log("Kiểu phần tử memList[0]:", typeof memList[0], JSON.stringify(memList[0]));
      
      const uids = memList.map(item => {
        if (typeof item === 'string') {
          return item.split('_')[0];
        } else if (item && typeof item === 'object') {
          return Object.keys(item)[0];
        }
        return String(item);
      }).filter(Boolean);

      console.log("Danh sách UID trích xuất (10 cái đầu):", uids.slice(0, 10));

      try {
        const membersInfo = await api.getGroupMembersInfo(uids.slice(0, 10));
        console.log("Thông tin thành viên (mẫu):", JSON.stringify(membersInfo, null, 2));
      } catch (err) {
        console.error("Lỗi lấy thông tin thành viên:", err.message);
      }
    }
  }
  process.exit(0);
}

run();
