require("dotenv").config();
const readline = require("readline-sync");

async function chat(question) {
  const response = await fetch("http://thaillm.or.th/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.THAILLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: "pathumma",
      messages: [
        {
          role: "system",
          content:
            "คุณคือแชทบอทให้คำแนะนำด้านสุขภาพจิตเบื้องต้น ตอบอย่างสุภาพ อบอุ่น ไม่วินิจฉัยโรค ไม่สั่งยา และแนะนำให้ติดต่อเจ้าหน้าที่จิตวิทยาเมื่อจำเป็น",
        },
        {
          role: "user",
          content: question,
        },
      ],
      max_tokens: 2048,
      temperature: 0.3,
    }),
  });

  const data = await response.json();

  let answer = data.choices[0].message.content;

  // ลบส่วน <think>...</think> ออก
  answer = answer.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  return answer;
}

async function main() {
  console.log("=== Pathumma Psychology Chatbot ===");
  console.log("พิมพ์ exit เพื่อออก\n");

  while (true) {
    const question = readline.question("คุณ: ");

    if (question.toLowerCase() === "exit") {
      console.log("บอท: ขอบคุณที่พูดคุยนะครับ");
      break;
    }

    const answer = await chat(question);
    console.log("บอท:", answer, "\n");
  }
}

main();