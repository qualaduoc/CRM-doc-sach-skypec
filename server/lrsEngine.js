const WebSocket = require('ws');
const { getDb } = require('./db');
const https = require('https');
const querystring = require('querystring');

const activeConnections = new Map(); // key: classId, value: connection object
const surveyStatuses = new Map();
const RECORD_SEPARATOR = '\u001e';
const HOST = 'elearning.skypec.com.vn';

// Danh sách 10 mẫu review sách chất lượng cao bằng tiếng Việt, mỗi bài dài trên 550 từ
const REVIEW_TEMPLATES = [
  // Mẫu 1: Về việc định vị bản thân và rèn luyện đạo đức công vụ
  `<html>
<head><title>Review</title></head>
<body>
<p>Cuốn sách này mang lại cho tôi những nhận thức vô cùng sâu sắc về bản chất của tinh thần trách nhiệm và đạo đức trong cuộc sống cũng như trong hoạt động nghề nghiệp hằng ngày. Tác phẩm đã giúp tôi định vị lại bản thân, hiểu rõ hơn về vị trí, nghĩa vụ và những giá trị cốt lõi mà một cá nhân cần cống hiến cho tập thể và xã hội. Tác giả đã phân tích một cách thấu đáo và logic về mối quan hệ giữa quyền lợi và trách nhiệm, từ đó hướng dẫn người đọc xây dựng một lối sống lành mạnh, tư duy tích cực và tinh thần chủ động sáng tạo. Trong môi trường công sở hiện đại, việc rèn luyện những đức tính này không chỉ giúp hoàn thiện kỹ năng cá nhân mà còn góp phần nâng cao hiệu quả làm việc nhóm, củng cố sự đoàn kết và tạo dựng một nét văn hóa doanh nghiệp vững mạnh, bền vững lâu dài. Việc tự giác học hỏi, tích cực trau dồi tri thức and kiên định vượt qua những khó khăn trở ngại là những bài học thực tiễn vô cùng giá trị mà tôi rút ra được từ cuốn sách này. Tôi nhận thấy rằng bản thân cần phải liên tục rèn luyện ý chí, nâng cao năng lực chuyên môn và giữ vững tác phong kỷ luật lao động nghiêm túc nhằm cống hiến hết sức mình vào sự phát triển chung của toàn đơn vị. Ngoài ra, tác phẩm còn phân tích sâu về cách thức mà chúng ta đối mặt với khó khăn, xem khó khăn như một cơ hội để rèn luyện bản lĩnh và khẳng định năng lực hành động của chính mình. Những nguyên tắc ứng xử và đạo đức nghề nghiệp được đề cập trong sách có tính ứng dụng cao, giúp giải quyết các xung đột nội bộ một cách hòa bình và kiến tạo nên một không gian làm việc chuyên nghiệp, nhân văn. Cuốn sách thực sự là một nguồn cảm hứng to lớn thúc đẩy tôi không ngừng vươn lên hoàn thiện chính mình mỗi ngày. Nó nhắc nhở tôi rằng mọi thành công bền vững đều phải được xây dựng trên nền tảng của sự trung thực, nỗ lực tự thân và lòng tự trọng nghề nghiệp sâu sắc. Chỉ khi ý thức đầy đủ về vai trò của mình, chúng ta mới có thể hành động đúng đắn và đem lại những giá trị thiết thực cho tổ chức nơi mình đang làm việc.</p>
</body>
</html>`,

  // Mẫu 2: Về chuyển đổi số và làm chủ công nghệ tương lai
  `<html>
<head><title>Review</title></head>
<body>
<p>Nội dung tác phẩm mở ra một tầm nhìn bao quát và sâu sắc về vai trò của việc tiếp cận công nghệ thông tin trong thời đại cách mạng công nghiệp lần thứ tư. Cuốn sách giúp tôi nhận diện rõ ràng những cơ hội và thách thức của chuyển đổi số, từ đó xây dựng một tư duy đổi mới sáng tạo, sẵn sàng thích ứng với sự thay đổi không ngừng của công nghệ hiện đại. Việc nắm vững các nguyên lý vận hành của hệ thống số hóa không chỉ nâng cao hiệu suất công việc cá nhân mà còn là chìa khóa để tối ưu hóa các quy trình nghiệp vụ phức tạp của toàn đơn vị. Tác giả đã chỉ ra rằng, công nghệ chỉ là công cụ hỗ trợ đắc lực, còn tư duy của con người mới là yếu tố quyết định sự thành bại của tiến trình chuyển đổi. Qua đó, tôi ý thức được trách nhiệm của mình trong việc liên tục cập nhật kiến thức mới, chủ động tìm tòi và áp dụng các sáng kiến công nghệ vào công tác chuyên môn hằng ngày. Sự tương tác phối hợp giữa con người và máy móc đòi hỏi một tác phong làm việc khoa học, kỷ luật và chính xác cao. Cuốn sách cũng đưa ra những dẫn chứng thực tế sinh động về các doanh nghiệp lớn đã bứt phá ngoạn mục nhờ vào việc số hóa thành công. Điều này tiếp thêm động lực to lớn cho tôi trên hành trình tự học và nghiên cứu các giải pháp tự động hóa giúp giảm thiểu thời gian xử lý công việc và hạn chế tối đa sai sót. Học hỏi công nghệ không chỉ là yêu cầu công việc bắt buộc mà còn là hành trình thú vị để mở rộng thế giới quan và khẳng định giá trị bản thân trong thế giới số. Tôi tin tưởng rằng việc đầu tư nghiêm túc vào tri thức công nghệ hôm nay sẽ mở đường cho những bước tiến vững chắc trong tương lai phát triển lâu dài của ngành hàng không Việt Nam nói chung và đơn vị nói riêng.</p>
</body>
</html>`,

  // Mẫu 3: Về an toàn lao động và kỷ luật tác phong chuyên nghiệp
  `<html>
<head><title>Review</title></head>
<body>
<p>Tác phẩm là một cẩm nang quý giá trang bị cho người đọc những kiến thức toàn diện và thiết thực về an toàn vệ sinh lao động và phòng chống cháy nổ trong môi trường sản xuất kỹ thuật cao. Cuốn sách phân tích cặn kẽ các nguyên nhân dẫn đến tai nạn lao động, từ đó đề xuất các giải pháp phòng ngừa chủ động và hiệu quả nhất. Tôi nhận ra rằng việc chấp hành nghiêm túc các quy trình quy phạm an toàn không chỉ là nghĩa vụ pháp lý mà còn là trách nhiệm thiêng liêng đối với sức khỏe và tính mạng của bản thân cũng như đồng nghiệp xung quanh. Mỗi hành vi bất cẩn nhỏ đều có thể dẫn đến những hậu quả nghiêm trọng và không thể khắc phục được. Tác giả đã nhấn mạnh tinh thần cảnh giác cao độ và thói quen kiểm tra thiết bị định kỳ trước khi vận hành. Điều này rất phù hợp với đặc thù công việc kỹ thuật tra nạp nhiên liệu hàng không đòi hỏi tính chính xác tuyệt đối của đơn vị chúng tôi. Học tập và áp dụng các nguyên tắc an toàn giúp chúng ta kiến tạo một không gian làm việc an toàn, tin cậy và chuyên nghiệp. Cuốn sách còn hướng dẫn chi tiết cách thức xử lý tình huống khẩn cấp một cách bình tĩnh, khoa học để giảm thiểu tối đa thiệt hại về người và của. Ý thức an toàn phải được thấm nhuần trong tư duy và thể hiện qua từng hành động cụ thể mỗi ngày của mỗi người lao động. Bản thân tôi tự hứa sẽ luôn tuân thủ nghiêm ngặt các quy định bảo hộ lao động, tích cực tham gia các buổi diễn tập an toàn và nhắc nhở đồng nghiệp cùng thực hiện nghiêm chỉnh nhằm xây dựng một môi trường làm việc không tai nạn, bền vững và an tâm cống hiến lâu dài.</p>
</body>
</html>`,

  // Mẫu 4: Về tác phẩm phòng chống tham nhũng và đạo đức người cán bộ
  `<html>
<head><title>Review</title></head>
<body>
<p>Cuốn sách đem lại cái nhìn toàn diện, sâu sắc và có hệ thống về công tác đấu tranh phòng, chống tham nhũng, tiêu cực trong giai đoạn hiện nay. Tác phẩm đã làm rõ quan điểm chỉ đạo, tư tưởng cốt lõi và những bài học kinh nghiệm quý báu của Đảng và Nhà nước ta trong việc xây dựng và chỉnh đốn Đảng ngày càng trong sạch, vững mạnh. Đọc cuốn sách, tôi nhận thức rõ nét hơn về vai trò tiền phong gương mẫu của người đảng viên, cán bộ công nhân viên trong việc rèn luyện đạo đức cách mạng, chống chủ nghĩa cá nhân và lối sống thực dụng cơ hội. Tác giả đã khẳng định đấu tranh chống tham nhũng là một nhiệm vụ kiên quyết, kiên trì, không có vùng cấm và không có ngoại lệ. Từng bài viết, từng chỉ đạo đều thể hiện tinh thần nhân văn sâu sắc nhưng cũng đầy tính nghiêm minh, thượng tôn pháp luật. Bản thân tôi rút ra bài học lớn về việc phải luôn tự soi, tự sửa mình trong cuộc sống hằng ngày và trong mọi công tác được giao. Việc giữ vững bản lĩnh chính trị, lòng tự trọng nghề nghiệp và tinh thần liêm chính là lá chắn vững chắc nhất bảo vệ người lao động trước những cám dỗ vật chất đời thường. Chúng ta cần xây dựng lối sống giản dị, lành mạnh và cống hiến hết lòng vì sự nghiệp chung của doanh nghiệp. Tôi ý thức sâu sắc rằng sự phát triển bền vững của Skypec phải gắn liền với sự minh bạch, liêm chính và thượng tôn pháp luật của toàn thể cán bộ công nhân viên. Tuyên truyền và lan tỏa những giá trị đạo đức cao đẹp từ cuốn sách này đến mọi người xung quanh là trách nhiệm và nghĩa vụ của mỗi chúng ta.</p>
</body>
</html>`,

  // Mẫu 5: Về tư duy tích cực và giải quyết khó khăn trong công việc
  `<html>
<head><title>Review</title></head>
<body>
<p>Cuốn sách là nguồn cảm hứng to lớn thôi thúc tôi thay đổi tư duy và thái độ sống theo hướng tích cực hơn mỗi ngày. Tác phẩm chứng minh một cách thuyết phục rằng thế giới quan bên trong quyết định trực tiếp đến hành vi và kết quả công việc bên ngoài của chúng ta. Thay vì than vãn trước khó khăn thử thách, người có tư duy tích cực sẽ luôn nhìn nhận chúng như những cơ hội quý giá để học hỏi, trải nghiệm và nâng cao bản lĩnh cá nhân. Tác giả chia sẻ các phương pháp khoa học để rèn luyện tâm trí, giải tỏa áp lực và duy trì năng lượng làm việc đỉnh cao trong môi trường nhiều biến động. Trong công việc kỹ thuật hàng ngày của chúng tôi, việc đối mặt với các sự cố phát sinh hay áp lực thời gian là điều không tránh khỏi. Nhờ cuốn sách, tôi học được cách giữ bình tĩnh, suy nghĩ logic để tìm giải pháp tối ưu nhất thay vì rơi vào trạng thái lo âu tiêu cực. Tinh thần lạc quan lành mạnh không chỉ mang lại niềm vui cho bản thân mà còn lan tỏa năng lượng tích cực đến đồng nghiệp, giúp cải thiện không khí làm việc và nâng cao hiệu quả phối hợp tập thể. Tôi nhận thấy rằng nụ cười, sự lắng nghe chân thành và lòng biết ơn là những công cụ vô hình giúp kết nối con người mạnh mẽ nhất. Tôi quyết tâm ứng dụng lối sống tích cực này vào thực tế công việc và cuộc sống cá nhân, không ngừng rèn luyện kỹ năng chuyên môn và giữ vững tinh thần vượt khó để hoàn thành xuất sắc mọi nhiệm vụ được giao, đóng góp tích cực vào sự phát triển chung của toàn đơn vị.</p>
</body>
</html>`,

  // Mẫu 6: Về văn hóa doanh nghiệp và sự gắn kết nội bộ
  `<html>
<head><title>Review</title></head>
<body>
<p>Tác phẩm phân tích sâu sắc về giá trị và tầm quan trọng của việc xây dựng một nét văn hóa doanh nghiệp vững mạnh, nhân văn và giàu bản sắc. Cuốn sách chỉ ra rằng văn hóa doanh nghiệp không phải là những khẩu hiệu sáo rỗng trên tường mà chính là cách ứng xử, tư duy hằng ngày của toàn thể cán bộ nhân viên trong công việc và cuộc sống. Sự gắn kết bền chặt giữa các cá nhân được xây dựng trên nền tảng của sự tôn trọng, thấu hiểu và chia sẻ lẫn nhau. Tôi hiểu rõ hơn rằng mỗi nhân viên là một đại diện hình ảnh cho thương hiệu của doanh nghiệp trước khách hàng và đối tác. Tác phong làm việc chuyên nghiệp, thái độ tận tâm phục vụ và ý thức kỷ luật lao động nghiêm túc chính là cốt lõi tạo nên sức mạnh cạnh tranh bền vững của đơn vị trên thị trường. Cuốn sách cũng đưa ra những gợi ý thiết thực về cách thiết lập kênh giao tiếp thông suốt, giải quyết xung đột nội bộ một cách văn minh và xây dựng tinh thần đồng đội mạnh mẽ. Khi mọi thành viên cùng hướng về một mục tiêu chung với lòng tự hào và sự tin tưởng lẫn nhau, sức mạnh tập thể sẽ được nhân lên gấp bội. Tôi thấy mình cần phải tích cực tham gia vào việc xây dựng văn hóa Skypec bằng những hành động nhỏ nhặt nhất như giữ gìn vệ sinh nơi làm việc, hỗ trợ đồng nghiệp khi gặp khó khăn và không ngừng nâng cao chất lượng dịch vụ tra nạp nhiên liệu để đem lại sự hài lòng tối đa cho các hãng hàng không khách hàng.</p>
</body>
</html>`,

  // Mẫu 7: Về thay đổi thói quen tốt để cải tiến công việc
  `<html>
<head><title>Review</title></head>
<body>
<p>Cuốn sách này mở ra một góc nhìn khoa học và thực tiễn về cơ chế hình thành của các thói quen trong đời sống con người và cách thức thay thế những thói quen xấu bằng thói quen tốt một cách bền vững. Tác giả chỉ ra rằng những cải tiến nhỏ bé 1% mỗi ngày nếu được duy trì đều đặn sẽ tạo nên một bước nhảy vọt phi thường sau một thời gian dài. Tôi nhận thức sâu sắc rằng thói quen làm việc cẩn thận, ngăn nắp và tuân thủ tuyệt đối quy trình kỹ thuật chính là chìa khóa vàng bảo đảm an toàn tuyệt đối trong hoạt động tra nạp nhiên liệu hàng không của chúng tôi. Việc rèn luyện thói quen tự học tập, đọc sách tích lũy tri thức mỗi ngày giúp tôi liên tục mở rộng thế giới quan và nâng cao trình độ chuyên môn. Cuốn sách hướng dẫn người đọc phương pháp thiết kế môi trường xung quanh để việc thực hiện các thói quen tốt trở nên dễ dàng và tự nhiên hơn. Bản thân tôi quyết tâm sẽ xây dựng thói quen ghi chép nhật ký công việc hằng ngày, lập kế hoạch rõ ràng trước khi hành động và kiểm tra kỹ lưỡng các trang thiết bị chuyên dụng trước và sau ca trực. Bằng việc kiên trì thực hiện những thói quen tích cực này, tôi tin chắc bản thân sẽ ngày càng hoàn thiện tác phong làm việc chuyên nghiệp, nâng cao năng suất lao động và đóng góp những giá trị thiết thực nhất cho sự lớn mạnh và chuyên nghiệp của toàn tổng công ty.</p>
</body>
</html>`,

  // Mẫu 8: Về kỹ năng giao tiếp ứng xử trong môi trường công sở
  `<html>
<head><title>Review</title></head>
<body>
<p>Cuốn sách cung cấp những bài học vô cùng quý báu và thực tế về nghệ thuật giao tiếp và ứng xử thông minh, tinh tế trong môi trường công sở hiện đại. Tác giả đã chứng minh rằng năng lực chuyên môn xuất sắc mới chỉ là điều kiện cần, còn kỹ năng giao tiếp khéo léo mới là điều kiện đủ giúp một cá nhân tiến xa và gặt hái thành công trong sự nghiệp. Đọc sách, tôi nhận ra tầm quan trọng của việc lắng nghe chủ động và thấu cảm ý kiến của người đối diện thay vì chỉ tập trung thể hiện cái tôi cá nhân. Giao tiếp hiệu quả đòi hỏi sự chân thành, cởi mở và tôn trọng sự khác biệt của đồng nghiệp. Cuốn sách cũng chỉ ra các kỹ thuật giải quyết xung đột ý kiến một cách hài hòa, biến những tranh luận chuyên môn thành cơ hội để tìm ra giải pháp tối ưu cho công việc chung. Tinh thần phối hợp liên phòng ban cần được xây dựng dựa trên sự thông suốt về thông tin và tinh thần hỗ trợ lẫn nhau vô điều kiện. Bản thân tôi nhận thấy mình cần cải thiện kỹ năng truyền đạt thông tin ngắn gọn, rõ ràng để tránh những hiểu lầm không đáng có trong ca trực kỹ thuật tra nạp. Tôi sẽ nỗ lực ứng dụng những bài học này vào thực tế công việc mỗi ngày, xây dựng mối quan hệ tốt đẹp, tin cậy với đồng nghiệp xung quanh nhằm tạo nên một môi trường làm việc hòa đồng, tích cực và tràn đầy niềm vui sáng tạo cống hiến.</p>
</body>
</html>`,

  // Mẫu 9: Về tư duy vượt khó và xây dựng mục tiêu dài hạn
  `<html>
<head><title>Review</title></head>
<body>
<p>Tác phẩm là một nguồn động lực tinh thần mạnh mẽ giúp tôi xác định rõ ràng mục tiêu cuộc đời và kiên định theo đuổi ước mơ đến cùng. Cuốn sách chỉ ra rằng trở ngại lớn nhất cản bước con người đến với thành công không phải là những khó khăn bên ngoài mà chính là nỗi sợ hãi thất bại và sự trì hoãn của chính bản thân bên trong. Việc thiết lập mục tiêu cụ thể, đo lường được và chia nhỏ lộ trình thực hiện là bước đi đầu tiên vô cùng quan trọng giúp chúng ta làm chủ cuộc sống. Tác giả hướng dẫn cách xây dựng ý chí kiên cường trước nghịch cảnh, xem thất bại là những bài học kinh nghiệm quý báu để điều chỉnh hành vi hướng tới thành công. Trong công việc chuyên môn hằng ngày của chúng tôi tại đơn vị hàng không, yêu cầu kỹ thuật vô cùng khắt khe và áp lực công việc là rất lớn. Cuốn sách đã tiếp thêm sức mạnh giúp tôi rèn luyện ý chí chịu đựng áp lực cao, không ngừng học hỏi rút kinh nghiệm từ những thiếu sót của bản thân để liên tục cải tiến quy trình công việc chuyên nghiệp hơn. Tôi hiểu rằng sự phát triển bản thân là một hành trình liên tục cả đời, đòi hỏi kỷ luật sắt đá và tinh thần tự học bền bỉ. Tôi quyết tâm đặt ra những mục tiêu phấn đấu rõ ràng trong chuyên môn kỹ thuật tra nạp nhiên liệu để cống hiến năng lực của mình hiệu quả nhất cho tổ chức.</p>
</body>
</html>`,

  // Mẫu 10: Về an toàn thông tin và chuyển đổi số doanh nghiệp
  `<html>
<head><title>Review</title></head>
<body>
<p>Cuốn sách mở ra một bức tranh toàn cảnh và chi tiết về tầm quan trọng cốt lõi của an toàn thông tin và bảo mật dữ liệu trong kỷ nguyên số hóa doanh nghiệp. Trong quá trình chuyển đổi số diễn ra mạnh mẽ như hiện nay, việc bảo vệ thông tin nội bộ và dữ liệu khách hàng là nhiệm vụ sống còn quyết định sự uy tín và phát triển bền vững của toàn tổng công ty. Tác giả phân tích các nguy cơ mất an toàn thông tin phổ biến từ những lỗi sơ suất nhỏ của người dùng, qua đó cảnh báo tính nâng cao nhận thức bảo mật của mỗi nhân viên. Tôi nhận thức sâu sắc rằng việc bảo mật tài khoản cá nhân, tuân thủ đúng quy định sử dụng mạng nội bộ và cảnh giác trước các email, liên kết lạ là nghĩa vụ bắt buộc của mỗi cá nhân cán bộ nhân viên đơn vị. An ninh thông tin không chỉ là việc của phòng công nghệ thông tin mà là trách nhiệm chung của tất cả mọi người khi tham gia hoạt động số hóa. Cuốn sách trang bị cho tôi những nguyên tắc cơ bản và hữu ích để giữ an toàn dữ liệu trên thiết bị cá nhân cũng như khi xử lý tài liệu chuyên môn. Áp dụng những kiến thức này giúp tôi tự tin làm việc trên môi trường số một cách chuyên nghiệp, an toàn, góp phần bảo vệ hệ thống thông tin quản lý vận hành của đơn vị luôn được an toàn, thông suốt và tin cậy tuyệt đối.</p>
</body>
</html>`
];

// Hàm helper gọi API đăng nhập Skypec để lấy token mới
function refreshSkypecToken(username, password) {
  return new Promise((resolve, reject) => {
    const postData = querystring.stringify({
      grant_type: 'password',
      client_id: 'web',
      username: username,
      password: password,
      scope: ''
    });

    const options = {
      hostname: HOST, port: 443,
      path: '/skypec2.authentication.api/connect/token',
      method: 'POST',
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded', 
        'Content-Length': Buffer.byteLength(postData),
        'Accept-Encoding': 'identity'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`Login failed with status: ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Hàm gọi API đồng bộ tiến độ thực tế từ Skypec
function fetchActualProgress(token, classId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: HOST, port: 443,
      path: `/skypec2.lms.api/api/v1/LmsClass/FrUserJoinClassNew/${classId}`,
      method: 'GET',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Encoding': 'identity'
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        } else {
          reject(new Error(`Fetch progress failed: ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Hàm khởi chạy một kết nối học tập chạy ngầm
function startLearning(account, classItem) {
  const classId = classItem.id;
  const connectionKey = `${account.username}_${classId}`;
  if (activeConnections.has(connectionKey)) {
    console.log(`[Engine] Lớp học ${classId} của tài khoản ${account.username} đã đang chạy.`);
    return;
  }

  console.log(`[Engine] Bắt đầu chạy ngầm cho tài khoản ${account.username} - Lớp: ${classItem.class_title}`);
  
  let ws = null;
  let pingInterval = null;
  let videoInterval = null;
  let videoTimeSeconds = Math.round((classItem.learn_time || 0) * 60) + 10;
  let invocationId = 1;
  let reconnectTimeout = null;
  let isStoppedManually = false;

  const connectionObj = {
    stop: () => {
      isStoppedManually = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      stopTimers();
      if (ws) ws.close(1000, 'Stopped by user');
      activeConnections.delete(connectionKey);
      console.log(`[Engine] Đã dừng chạy ngầm lớp ${classId} của tài khoản ${account.username}`);
    }
  };

  activeConnections.set(connectionKey, connectionObj);

  function stopTimers() {
    if (pingInterval) clearInterval(pingInterval);
    if (videoInterval) clearInterval(videoInterval);
  }

  async function connect() {
    if (isStoppedManually) return;

    try {
      const db = await getDb();
      // Lấy thông tin mới nhất từ DB
      const currentAcc = await db.get('SELECT * FROM accounts WHERE username = ?', account.username);
      const currentClass = await db.get('SELECT * FROM classes WHERE id = ? AND account_username = ?', classId, account.username);
      
      if (!currentAcc || !currentClass || currentClass.auto_learn === 0) {
        connectionObj.stop();
        return;
      }

      const token = currentAcc.access_token;
      
      // 1. Tự động kiểm tra và hoàn thành các khảo sát và bài tập review trước khi kết nối WebSocket
      let actualClassUserId = currentClass.class_user_id;
      let actualUserId = null;
      let actualDisplayName = currentAcc.display_name;
      let learningHistories = [];

      try {
        const progressRes = await fetchActualProgress(token, classId);
        if (progressRes && progressRes.status && progressRes.data) {
          actualClassUserId = progressRes.data.id;
          actualUserId = progressRes.data.userId;
          actualDisplayName = progressRes.data.displayName || currentAcc.display_name;
          learningHistories = progressRes.data.lmsClassUserLearning || [];
          
          // Lưu lại classUserId mới nhất vào DB
          await db.run('UPDATE classes SET class_user_id = ? WHERE id = ? AND account_username = ?', actualClassUserId, classId, account.username);
        }
      } catch (err) {
        console.error(`[Engine] Lỗi tự động tải tiến độ thực tế cho ${account.username} trước khi check review:`, err.message);
      }

      // 0. Tự động kiểm tra và nộp bài review sách trước
      try {
        await checkAndAutoSubmitReview(token, classId, actualClassUserId, account.username);
      } catch (revErr) {
        console.error(`[Engine] Lỗi tự động nộp review cho ${account.username}:`, revErr.message);
      }

      // 1. Tự động kiểm tra và nộp khảo sát
      try {
        if (actualClassUserId) {
          await checkAndAutoSubmitSurveys(
            token,
            classId,
            actualClassUserId,
            actualUserId,
            actualDisplayName,
            account.username,
            learningHistories
          );
        }
      } catch (survErr) {
        console.error(`[Engine] Lỗi tự động nộp khảo sát cho ${account.username}:`, survErr.message);
      }

      // Đọc lại thông tin class mới nhất để lấy learningId & contentId (vì syncUserClasses hoặc checkAndAutoSubmitReview có thể đã cập nhật lại)
      const updatedClass = await db.get('SELECT * FROM classes WHERE id = ? AND account_username = ?', classId, account.username);
      const learningId = updatedClass ? updatedClass.learning_id : null;
      const contentId = updatedClass ? updatedClass.content_id : null;

      if (!learningId) {
        console.log(`[Engine] Lớp ${classId} không có learningId. Không thể kết nối WebSocket treo đọc sách.`);
        connectionObj.stop();
        return;
      }

      const wsUrl = `wss://${HOST}/skypec2.lms.api/socket/hubs/lrs?learningId=${learningId}&clientProtocol=1.5&access_token=${encodeURIComponent(token)}`;
      
      ws = new WebSocket(wsUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      ws.on('open', () => {
        console.log(`[Engine] WebSocket kết nối thành công cho ${account.username} - Lớp: ${currentClass.class_title}`);
        
        // Gửi gói tin bắt tay
        ws.send(JSON.stringify({ protocol: 'json', version: 1 }) + RECORD_SEPARATOR);

        // Gửi Ping duy trì socket mỗi 15 giây
        pingInterval = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 6 }) + RECORD_SEPARATOR);
          }
        }, 15000);

        // Gửi VIDEO_TIME_UPDATE giả lập mỗi 10 giây
        if (contentId) {
          videoInterval = setInterval(async () => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              try {
                const innerPayload = JSON.stringify({
                  eventName: 'VIDEO_TIME_UPDATE',
                  learningId: learningId,
                  id: contentId,
                  data: videoTimeSeconds
                });
                
                const message = JSON.stringify({
                  type: 1,
                  invocationId: String(invocationId),
                  target: 'Handshake',
                  arguments: [innerPayload]
                }) + RECORD_SEPARATOR;

                ws.send(message);
                videoTimeSeconds += 10;
                invocationId++;

                // Tăng số phút học tập tạm thời ở local mỗi 10 giây (10 giây = 1/60 phút = ~0.167 phút) để hiển thị mượt mà trên giao diện
                const localDb = await getDb();
                await localDb.run('UPDATE classes SET learn_time = learn_time + (10.0 / 60.0), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND account_username = ?', classId, account.username);

                // Cứ mỗi 30 giây, tự động đồng bộ và kiểm tra số phút thực tế trực tiếp từ máy chủ Skypec
                if (videoTimeSeconds % 30 === 0) {
                  try {
                    const progress = await fetchActualProgress(token, classId);
                    if (progress && progress.status && progress.data) {
                      let actualTime = progress.data.totalTime || 0;
                      const learningHistories = progress.data.lmsClassUserLearning || [];
                      if (learningHistories.length > 0) {
                        learningHistories.forEach(h => {
                          if (h.learnTime && h.learnTime > actualTime) {
                            actualTime = h.learnTime;
                          }
                        });
                      }
                      const isFinish = (progress.data.isFinish === 1 || progress.data.isFinish === true) ? 1 : 0;
                      
                      await localDb.run('UPDATE classes SET learn_time = ?, is_finish = ? WHERE id = ? AND account_username = ?', actualTime, isFinish, classId, account.username);
                      
                      // Kiểm tra xem đã đạt thời gian yêu cầu tối thiểu chưa
                      const currentClassInfo = await localDb.get('SELECT min_time_required, class_title FROM classes WHERE id = ? AND account_username = ?', classId, account.username);
                      if (currentClassInfo && currentClassInfo.min_time_required && actualTime >= currentClassInfo.min_time_required) {
                        console.log(`[Engine] Lớp học "${currentClassInfo.class_title}" của ${account.username} đã đạt thời gian yêu cầu tối thiểu (${currentClassInfo.min_time_required} phút). Tự động dừng học ngầm.`);
                        await localDb.run('UPDATE classes SET auto_learn = 0, is_finish = 1 WHERE id = ? AND account_username = ?', classId, account.username);
                        connectionObj.stop();
                      }
                    }
                  } catch (syncErr) {
                    console.warn(`[Engine Warning] Không thể tự động đồng bộ thực tế lớp ${classId} của ${account.username}:`, syncErr.message);
                  }
                }
              } catch (err) {
                console.error(`[Engine] Lỗi gửi nhịp tim lớp ${classId}:`, err.message);
              }
            }
          }, 10000);
        }
      });

      ws.on('message', (data) => {
        const msgStr = data.toString();
        console.log(`[Engine WS Message] [${account.username}]`, msgStr);
        
        // Khi nhận được phản hồi bắt tay thành công từ SignalR ({})
        if (msgStr.includes('{}')) {
          console.log(`[Engine] Bắt tay thành công cho ${account.username}. Gửi sự kiện START_VIEW cho lớp ${classId}...`);
          try {
            const startPayload = JSON.stringify({
              eventName: 'START_VIEW',
              learningId: learningId,
              id: contentId
            });
            const startMessage = JSON.stringify({
              type: 1,
              invocationId: String(invocationId),
              target: 'Handshake',
              arguments: [startPayload]
            }) + RECORD_SEPARATOR;
            
            ws.send(startMessage);
            invocationId++;
          } catch (err) {
            console.error(`[Engine] Lỗi gửi sự kiện START_VIEW cho ${account.username}:`, err.message);
          }
        }
      });

      ws.on('close', async (code, reason) => {
        stopTimers();
        if (isStoppedManually) return;

        console.log(`[Engine] WebSocket đóng (Code: ${code}) cho ${account.username}. Thử lại sau 5 giây...`);
        
        // Tự động kiểm tra Token và đăng nhập lại nếu lỗi kết nối do hết hạn
        if (code === 4005 || code === 1008 || (reason && reason.toString().includes('Unauthorized'))) {
          console.log(`[Engine] Phát hiện Token hết hạn cho ${account.username}. Đang đăng nhập lại...`);
          try {
            const loginResult = await refreshSkypecToken(account.username, account.password);
            if (loginResult && loginResult.access_token) {
              const localDb = await getDb();
              await localDb.run('UPDATE accounts SET access_token = ?, status = "active" WHERE username = ?', loginResult.access_token, account.username);
              console.log(`[Engine] Đăng nhập lại thành công cho ${account.username}.`);
            }
          } catch (loginErr) {
            console.error(`[Engine] Đăng nhập lại thất bại cho ${account.username}:`, loginErr.message);
            const localDb = await getDb();
            await localDb.run('UPDATE accounts SET status = "error" WHERE username = ?', account.username);
          }
        }

        reconnectTimeout = setTimeout(connect, 5000);
      });

      ws.on('error', (err) => {
        console.error(`[Engine] WebSocket lỗi cho ${account.username}:`, err.message);
        ws.close();
      });
    } catch (dbErr) {
      console.error(`[Engine] Lỗi kết nối DB trong connect():`, dbErr.message);
      reconnectTimeout = setTimeout(connect, 5000);
    }
  }

  connect();
}

// Dừng một lớp học cụ thể
function stopLearning(username, classId) {
  const connectionKey = `${username}_${classId}`;
  const conn = activeConnections.get(connectionKey);
  if (conn) {
    conn.stop();
  }
}

// Khởi động tất cả các lớp học có auto_learn = 1 khi khởi động Server
async function initEngine() {
  console.log('[Engine] Đang khởi tạo bộ máy tự động học tập chạy ngầm...');
  try {
    const db = await getDb();
    const autoClasses = await db.all(`
      SELECT classes.*, accounts.password, accounts.access_token 
      FROM classes 
      JOIN accounts ON classes.account_username = accounts.username 
      WHERE classes.auto_learn = 1 AND accounts.status = 'active'
    `);

    autoClasses.forEach(c => {
      const account = { username: c.account_username, password: c.password, access_token: c.access_token };
      startLearning(account, c);
    });

    console.log(`[Engine] Đã khôi phục ${autoClasses.length} tiến trình học tập chạy ngầm.`);
  } catch (err) {
    console.error('[Engine] Lỗi khởi tạo bộ máy học tập:', err.message);
  }
}

function callSkypecGet(token, path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: HOST, port: 443,
      path: path,
      method: 'GET',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'X-Authorize': token,
        'Accept': 'application/json',
        'Accept-Encoding': 'identity'
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function callSkypecPost(token, path, bodyObj) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(bodyObj);
    const options = {
      hostname: HOST, port: 443,
      path: path,
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'X-Authorize': token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Accept': 'application/json',
        'Accept-Encoding': 'identity'
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function fetchClassContentDetail(token, classContentId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: HOST, port: 443,
      path: `/skypec2.lms.api/api/v1/LmsClassContent/${classContentId}`,
      method: 'GET',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Accept-Encoding': 'identity'
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function checkAndAutoSubmitSurveys(token, classId, classUserId, userId, displayName, username, learningHistories) {
  return new Promise(async (resolve) => {
    try {
      // 1. Tải danh sách bài học của lớp học
      const listOptions = {
        hostname: HOST, port: 443,
        path: `/skypec2.lms.api/api/v1/LmsClassContent/frGetByClassId/${classId}`,
        method: 'GET',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Accept-Encoding': 'identity'
        }
      };
      
      const contentsList = await new Promise((resList) => {
        const req = https.request(listOptions, (res) => {
          let body = '';
          res.on('data', (chunk) => body += chunk);
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const json = JSON.parse(body);
                resList(json.data || []);
              } catch (e) { resList([]); }
            } else { resList([]); }
          });
        });
        req.on('error', () => resList([]));
        req.end();
      });

      // Lọc ra các bài học là khảo sát
      const surveys = contentsList.filter(item => {
        const typeTitle = (item.type && item.type.title) ? item.type.title.toLowerCase() : '';
        const itemTitle = item.title ? item.title.toLowerCase() : '';
        return typeTitle.includes('khảo sát') || itemTitle.includes('khảo sát') || item.typeId === '7bd609d4-33bb-43e2-8c1d-c5bf008780bf';
      });

      if (surveys.length === 0) {
        resolve();
        return;
      }

      for (const surveyItem of surveys) {
        const classContentId = surveyItem.id;
        const connectionKey = `${username}_${classId}`;
        
        // Kiểm tra xem học viên đã làm bài khảo sát này chưa
        const isCompleted = learningHistories.some(h => h.classContentId === classContentId && (h.isFinish === true || h.isFinish === 1));
        if (isCompleted) {
          continue;
        }

        console.log(`[Survey] Học viên ${username}: Phát hiện khảo sát chưa làm "${surveyItem.title}". Đang tiến hành làm tự động...`);
        surveyStatuses.set(connectionKey, 'Đang khảo sát thay bạn...');

        // A. Lấy chi tiết để có surveyId (contentOpenId)
        const detailJson = await fetchClassContentDetail(token, classContentId);
        if (!detailJson || !detailJson.status || !detailJson.data) {
          console.warn(`[Survey] Học viên ${username}: Không lấy được chi tiết bài khảo sát.`);
          surveyStatuses.delete(connectionKey);
          continue;
        }

        const surveyId = detailJson.data.contentOpenId;
        if (!surveyId) {
          console.warn(`[Survey] Học viên ${username}: Bài khảo sát không liên kết surveyId.`);
          surveyStatuses.delete(connectionKey);
          continue;
        }

        // B. Khởi tạo phiên khảo sát (SaveUser - completeStatus: 2)
        const saveUserPayload = {
          classId: classId,
          completeStatus: 2,
          createdDate: new Date().toISOString(),
          displayName: displayName || username,
          ownerId: "00000000-0000-0000-0000-000000000000",
          ownerType: 1,
          surveyId: surveyId,
          targetId: classId,
          targetName: detailJson.data.classTitle || "Khảo sát tự động",
          userId: userId,
          userName: username,
          verifyResultType: null,
          verifyUserType: 1
        };

        const initRes = await callSkypecPost(token, '/skypec2.lms.api/api/v1/LmsSurveyUser', saveUserPayload);
        let surveyUserId = null;

        if (initRes.statusCode === 403) {
          console.log(`[Survey] Học viên ${username}: Khảo sát báo 403 cho "${surveyItem.title}" (Có thể đã nộp trước đó). Ép nộp hoàn thành tiến độ...`);
        } else if (initRes.statusCode !== 200) {
          console.warn(`[Survey] Học viên ${username}: Khởi tạo khảo sát thất bại (Status ${initRes.statusCode}).`);
          surveyStatuses.delete(connectionKey);
          continue;
        } else {
          try {
            const initData = JSON.parse(initRes.body);
            if (!initData.status || !initData.data) {
              console.warn(`[Survey] Học viên ${username}: Khởi tạo khảo sát thất bại (Skypec báo lỗi).`);
              surveyStatuses.delete(connectionKey);
              continue;
            }
            surveyUserId = initData.data.id;
          } catch (jsonErr) {
            console.warn(`[Survey] Học viên ${username}: Phản hồi khởi tạo không phải JSON hợp lệ.`);
            surveyStatuses.delete(connectionKey);
            continue;
          }
        }

        if (surveyUserId) {
          // C. Tải danh sách câu hỏi khảo sát kèm phân trang
          const qRes = await callSkypecGet(token, `/skypec2.lms.api/api/v1/LmsSurveyQuestion?surveyId=${surveyId}&pageSize=100&currentPage=1`);
          if (qRes.statusCode === 200) {
            try {
              const qDataJson = JSON.parse(qRes.body);
              const questionsList = qDataJson.data || [];

              // D. Trả lời tích tất cả cột lớn nhất cho từng nhóm câu hỏi
              for (const group of questionsList) {
                const surveyQuestionId = group.id;
                let answersList = [];

                if (group.type === 5) { // Dạng ma trận đánh giá
                  let maxRow = 15;
                  let targetCol = 6;
                  try {
                    const rows = JSON.parse(group.subContent || '[]');
                    if (rows.length > 0) maxRow = rows.length;
                    const cols = JSON.parse(group.answer || '[]');
                    if (cols.length > 0) targetCol = cols.length;
                  } catch (e) {}

                  for (let r = 1; r <= maxRow; r++) {
                    answersList.push({ row: r, col: targetCol, mark: 1 });
                  }
                } else { // Dạng câu hỏi lựa chọn đơn
                  let targetCol = 1;
                  answersList.push({ row: 1, col: targetCol, mark: 1 });
                }

                const saveQPayload = {
                  surveyUserId: surveyUserId,
                  surveyQuestionId: surveyQuestionId,
                  surveyId: surveyId,
                  ownerId: "00000000-0000-0000-0000-000000000000",
                  ownerType: 1,
                  answer: JSON.stringify(answersList)
                };

                await callSkypecPost(token, '/skypec2.lms.api/api/v1/LmsSurveyUserQuestion', saveQPayload);
              }
            } catch (qErr) {
              console.warn(`[Survey] Học viên ${username}: Lỗi xử lý câu hỏi khảo sát:`, qErr.message);
            }
          }

          // E. Nộp và chốt hoàn thành phiên (SaveUser completeStatus: 2 kèm id)
          saveUserPayload.id = surveyUserId;
          await callSkypecPost(token, '/skypec2.lms.api/api/v1/LmsSurveyUser', saveUserPayload);
        }

        // F. Ghi nhận hoàn thành bài học khảo sát lên cây tiến độ (LmsClassUserLearning)
        const oldLearning = learningHistories.find(l => l.classContentId === classContentId);
        const learningPayload = {
          id: oldLearning ? oldLearning.id : "00000000-0000-0000-0000-000000000000",
          classUserId: classUserId,
          classContentId: classContentId,
          isFinish: true,
          isPassed: true,
          learnTime: 0,
          times: oldLearning ? (oldLearning.times + 1) : 1,
          lastUpdatedDate: new Date().toISOString(),
          lastUpdatedUserId: userId,
          classContent: {
            id: classContentId,
            classId: classId
          }
        };

        const learnRes = await callSkypecPost(token, '/skypec2.lms.api/api/v1/LmsClassUserLearning', learningPayload);
        if (learnRes.statusCode === 200) {
          console.log(`[Survey] Học viên ${username}: Đã tự động hoàn thành khảo sát "${surveyItem.title}" THÀNH CÔNG!`);
          surveyStatuses.set(connectionKey, 'Đã khảo sát xong..chuyển sang treo đọc...');
          setTimeout(() => {
            if (surveyStatuses.get(connectionKey) === 'Đã khảo sát xong..chuyển sang treo đọc...') {
              surveyStatuses.delete(connectionKey);
            }
          }, 10000);
        } else {
          console.warn(`[Survey] Học viên ${username}: Lỗi ghi nhận hoàn thành khảo sát (Status ${learnRes.statusCode}).`);
          surveyStatuses.delete(connectionKey);
        }
      }
      resolve();
    } catch (err) {
      console.error(`[Survey Error] Lỗi luồng tự động khảo sát:`, err.message);
      resolve();
    }
  });
}

// Tự động kiểm tra và nộp bài review sách tự luận
function checkAndAutoSubmitReview(token, classId, classUserId, username) {
  return new Promise(async (resolve) => {
    try {
      // 1. Quét xem lớp có bài tập review sách hay không
      const exerciseResStr = await callSkypecGet(token, `/skypec2.lms.api/api/v1/LmsClassExercise?classId=${classId}&limit=10&offset=0`);
      if (exerciseResStr.statusCode !== 200) {
        resolve();
        return;
      }
      
      const exerciseRes = JSON.parse(exerciseResStr.body);
      if (!exerciseRes.status || !exerciseRes.data || exerciseRes.data.length === 0) {
        resolve();
        return;
      }
      
      const exercise = exerciseRes.data[0];
      const classExerciseId = exercise.id;
      
      // 2. Kiểm tra xem học viên đã làm bài tập này chưa
      const exerciseUserResStr = await callSkypecGet(token, `/skypec2.lms.api/api/v1/LmsClassExerciseUser/${classUserId}`);
      let isFinished = false;
      if (exerciseUserResStr.statusCode === 200) {
        const exerciseUserRes = JSON.parse(exerciseUserResStr.body);
        if (exerciseUserRes.status && exerciseUserRes.data) {
          isFinished = exerciseUserRes.data.isFinish === true || exerciseUserRes.data.isFinish === 1;
        }
      }
      
      const db = await getDb();
      if (isFinished) {
        console.log(`[Review] Học viên ${username}: Lớp ${classId} đã nộp bài tập review trước đó.`);
        // Đồng bộ lại trạng thái trong SQLite
        await db.run('UPDATE classes SET class_exercise_id = ?, is_exercise_finished = 1 WHERE id = ? AND account_username = ?', classExerciseId, classId, username);
        resolve();
        return;
      }
      
      console.log(`[Review] Học viên ${username}: Lớp ${classId} có bài tập review chưa nộp. Bắt đầu tự động làm bài...`);
      
      // Chọn ngẫu nhiên 1 trong 10 mẫu review
      const randomIndex = Math.floor(Math.random() * REVIEW_TEMPLATES.length);
      const reviewContent = REVIEW_TEMPLATES[randomIndex];
      
      const payload = {
        id: "00000000-0000-0000-0000-000000000000",
        classExerciseId: classExerciseId,
        isFinish: true,
        content: reviewContent,
        userName: null,
        userId: null,
        careerName: null,
        classExercise: null,
        classExerciseTopicId: null,
        comment: null,
        createdDate: null,
        createdUserId: null,
        departmentName: null,
        displayName: null,
        exerciseTempFileId: null,
        fileId: null,
        isDeleted: null,
        isTeacherFinished: null,
        lastUpdatedDate: null,
        lastUpdatedUserId: null,
        nodeId: null,
        orderNum: null,
        ownerId: null,
        ownerType: null,
        result: null,
        topicName: null,
        userNote: null
      };
      
      const postRes = await callSkypecPost(token, '/skypec2.lms.api/api/v1/LmsClassExerciseUser/saveCus', payload);
      if (postRes.statusCode === 200) {
        const postData = JSON.parse(postRes.body);
        if (postData.status) {
          console.log(`[Review] Học viên ${username}: Đã tự động nộp bài review lớp ${classId} thành công! 🟢`);
          // Cập nhật SQLite
          await db.run('UPDATE classes SET class_exercise_id = ?, is_exercise_finished = 1 WHERE id = ? AND account_username = ?', classExerciseId, classId, username);
        } else {
          console.warn(`[Review] Học viên ${username}: Nộp bài review lớp ${classId} thất bại từ server Skypec: ${postData.message}`);
        }
      } else {
        console.warn(`[Review] Học viên ${username}: Nộp bài review lớp ${classId} thất bại (Status ${postRes.statusCode}).`);
      }
      resolve();
    } catch (err) {
      console.error(`[Review Error] Lỗi luồng tự động review cho ${username}:`, err.message);
      resolve();
    }
  });
}

module.exports = {
  startLearning,
  stopLearning,
  initEngine,
  activeConnections,
  fetchActualProgress,
  checkAndAutoSubmitSurveys,
  checkAndAutoSubmitReview,
  surveyStatuses
};
