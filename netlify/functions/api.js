// 无需安装任何依赖，Node 18+ 原生支持 fetch

exports.handler = async (event, context) => {
  // 1. 获取请求信息
  const { httpMethod, path, body, queryStringParameters, isBase64Encoded } = event;

  // 2. 设置 CORS 头（允许前端跨域调用，同域下其实不需要，但加上无害）
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  // 3. 处理预检请求（OPTIONS）
  if (httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // 4. 路由：健康检查
  if (path === '/api/health' && httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }),
    };
  }

  // 5. 路由：分析 JD
  if (path === '/api/analyze' && httpMethod === 'POST') {
    try {
      // 解析请求体（支持 Base64 编码）
      let requestBodyStr = body || '{}';
      if (isBase64Encoded) {
        requestBodyStr = Buffer.from(body, 'base64').toString('utf-8');
      }
      
      let requestBody;
      try {
        requestBody = JSON.parse(requestBodyStr);
      } catch (e) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: '无效的 JSON 格式' }),
        };
      }

      const { jdContent } = requestBody;

      if (!jdContent || jdContent.trim() === '') {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: '请提供JD内容' }),
        };
      }

      // 构造 Prompt（完全保持原样）
      const prompt = `你是一位专业的招聘顾问，请仔细分析以下岗位JD，然后以JSON格式返回分析结果。所有内容都要基于JD原文，不可凭空捏造。

JD内容：
${jdContent}

请返回如下JSON结构（只返回JSON，不要任何其他文字）：
{
"summary": "一句话总结这个岗位的核心要求和工作内容，使用通俗易懂的大白话",
"top3": ["最重要的工作职责1（大白话）", "最重要的工作职责2（大白话）", "最重要的工作职责3（大白话）"],
"hard": ["硬门槛要求1：JD原文内容 + 大白话说明", "硬门槛要求2：JD原文内容 + 大白话说明"],
"soft": ["可培养能力1：JD中提到的了解/熟悉的能力", "可培养能力2：JD中提到的了解/熟悉的能力"],
"bonus": ["加分项1：JD中提到的优先/加分条件", "加分项2：JD中提到的优先/加分条件"],
"translations": [
{"term": "JD原句1", "meaning": "大白话翻译", "example": "实际工作例子"},
{"term": "JD原句2", "meaning": "大白话翻译", "example": "实际工作例子"},
{"term": "JD原句3", "meaning": "大白话翻译", "example": "实际工作例子"}
],
"questions_ask": ["面试反问问题1", "面试反问问题2", "面试反问问题3"],
"questions_expect": ["面试官可能问的问题1", "面试官可能问的问题2", "面试官可能问的问题3"]
}`;

      // 调用 DeepSeek API
      const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
      if (!DEEPSEEK_API_KEY) {
        console.error('Missing DEEPSEEK_API_KEY environment variable');
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: '服务器配置错误：缺少 API Key' }),
        };
      }

      const apiResponse = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          max_tokens: 2000,
          temperature: 0.7,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!apiResponse.ok) {
        const errorData = await apiResponse.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `API请求失败: ${apiResponse.status}`);
      }

      const data = await apiResponse.json();
      const rawText = data.choices?.[0]?.message?.content || '';

      // 解析 JSON 结果（处理可能被 markdown 包裹的情况）
      let result;
      try {
        const cleanText = rawText.replace(/```json|```/g, '').trim();
        result = JSON.parse(cleanText);
      } catch (parseError) {
        // 兜底结构
        result = {
          summary: '解析结果异常',
          top3: ['解析失败，请重试'],
          hard: [],
          soft: [],
          bonus: [],
          translations: [],
          questions_ask: [],
          questions_expect: [],
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(result),
      };
    } catch (error) {
      console.error('分析错误:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: '分析失败，请稍后重试' }),
      };
    }
  }

  // 未匹配的路由
  return {
    statusCode: 404,
    headers,
    body: JSON.stringify({ error: 'Not Found' }),
  };
};