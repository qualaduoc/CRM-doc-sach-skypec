import { ZaloApiError } from "../Errors/ZaloApiError.js";
import { ThreadType } from "../models/index.js";
import { apiFactory, removeUndefinedKeys } from "../utils.js";

// Send a custom sticker (static/webp) via photo_url endpoints, marked as sticker
export const sendCustomStickerFactory = apiFactory()((api, ctx, utils) => {
  const serviceURL = {
    [ThreadType.User]: utils.makeURL(`${api.zpwServiceMap.file[0]}/api/message/photo_url`, { nretry: "0" }),
    [ThreadType.Group]: utils.makeURL(`${api.zpwServiceMap.file[0]}/api/group/photo_url`, { nretry: "0" }),
  };

  /**
   * Send a custom sticker to a thread using static and animation URLs
   *
   * @param message A DeliveredMessage or Message-like object containing type, threadId and optional data.quote
   * @param staticImgUrl PNG/JPG/JPEG url for the static sticker preview
   * @param animationImgUrl WEBP url for the animated sticker
   * @param width Sticker width (defaults 498)
   * @param height Sticker height (defaults 332)
   * @param ttl Message TTL
   */
  return async function sendCustomSticker(message, staticImgUrl, animationImgUrl, width = 498, height = 332, ttl = 0) {
    if (!message) throw new ZaloApiError("Missing message");
    if (!staticImgUrl) throw new ZaloApiError("Missing static image URL");
    if (!animationImgUrl) throw new ZaloApiError("Missing animation image URL");

    const type = message.type === ThreadType.Group ? ThreadType.Group : ThreadType.User;
    const threadId = message.threadId;
    if (!threadId) throw new ZaloApiError("Missing threadId from message");

    // message.data?.quote may contain ref cliMsgId
    const quote = message?.data?.quote;

    const params = {
      clientId: Date.now(),
      title: "",
      oriUrl: staticImgUrl,
      thumbUrl: staticImgUrl,
      hdUrl: staticImgUrl,
      width: parseInt(String(width)),
      height: parseInt(String(height)),
      properties: JSON.stringify({
        subType: 1,
        color: -1,
        size: -1,
        type: 3,
        ext: JSON.stringify({
          sSrcStr: "@STICKER",
          sSrcType: 1,
          pStickerType: 1,
        }),
      }),
      contentId: Date.now(),
      // keep thumb size consistent with image size
      thumb_width: parseInt(String(width)),
      thumb_height: parseInt(String(height)),
      webp: JSON.stringify({
        width: parseInt(String(width)),
        height: parseInt(String(height)),
        url: animationImgUrl,
      }),
      zsource: -1,
      ttl: ttl,
    };

    if (quote && quote.cliMsgId) params.refMessage = String(quote.cliMsgId);

    if (type === ThreadType.Group) {
      Object.assign(params, { visibility: 0, grid: String(threadId) });
    } else {
      Object.assign(params, { toId: String(threadId) });
    }

    removeUndefinedKeys(params);
    const encryptedParams = utils.encodeAES(JSON.stringify(params));
    if (!encryptedParams) throw new ZaloApiError("Failed to encrypt message");

    const response = await utils.request(serviceURL[type], {
      method: "POST",
      body: new URLSearchParams({ params: encryptedParams }),
    });
    return utils.resolve(response);
  };
});


