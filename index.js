import express from "express";
import dotenv from "dotenv";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai"
import { TavilySearch } from "@langchain/tavily";
import { createAgent,tool } from "langchain";
import { z } from "zod";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { MessagesAnnotation, StateGraph, MemorySaver, StateSchema, interrupt, Command } from "@langchain/langgraph";
import { MongoClient } from "mongodb"
import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { ChatGroq } from "@langchain/groq"
import {randomUUID} from "node:crypto"


dotenv.config();

const app = express(); 

const port=5000; 
app.use(express.json());

const client = new MongoClient("mongodb://dj9793181198_db_user:4bj5RPAe6qIrAlZg@ac-btxbsic-shard-00-00.uozwd1c.mongodb.net:27017,ac-btxbsic-shard-00-01.uozwd1c.mongodb.net:27017,ac-btxbsic-shard-00-02.uozwd1c.mongodb.net:27017/?ssl=true&replicaSet=atlas-yg3sqd-shard-0&authSource=admin");
const checkpointer = new MongoDBSaver({ client })
const tool1 = new TavilySearch({
  maxResults: 5,
  topic: "general",
});

// const tool2= tool(
//     ({a,b})=>{
//         return `addition of ${a} and ${b} is 7`;

//     },{
//     name:"Additon_Tool",
//     description:"Use this tool to add two numbers",
//     schema:z.object({
//         a:z.number(),
//         b:z.number()
//     })
//     }
// )

// const tool3= tool(
//     (email,content)=>{
//         return `Email sent to ${email} with content: ${content}`;
//     },{
//         name:"email_sender_tool",
//         description:"Use this tool to send an email",
//         schema:z.object({
//             email:z.string().describe("Email address of the recipient"),
//             content:z.string().describe("Content of the email")
//         })
//     }
// )
// const tools= [tool1,tool2,tool3];

// const toolNode= new ToolNode(tools);

// const agent = async (state)=>{
//     const result= await model.invoke(state.messages)
//     return{
//         messages:[result]
//     }


// }
// const shouldContinue=async (state)=>{
//     console.log(state.messages)
//     if(state.messages[state.messages.length-1].tool_calls.length>0){
//         return "tool";
//     }else{
//         return "__end__"
//     }


// }

// const graph= new StateGraph(MessagesAnnotation)
// .addNode("agent",agent)
// .addNode("tool",toolNode)
// .addEdge("__start__","agent")
// .addEdge("tool","agent")
// .addConditionalEdges("agent",shouldContinue)
// .compile({checkpointer})



// const model = new ChatGoogleGenerativeAI({
//     model: "gemini-3.5-flash",
//     temperature: 0.7,
//     maxRetries: 2,

// }).bindTools(tools);

// app.post("/ai", async (req, res) => {
//   const {input}=req.body;
//   const result= await graph.invoke({
//     messages:[
//         {
//         role:"user",
//         content:input
//         }
//     ]

//   },{configurable:{thread_id: "1"}})
//   return res.json(result.messages[result.messages.length-1].content)

// })

const customState= new StateSchema({
    prompt:z.string(),
    approval_requires:z.boolean(),
    aiResponse:z.string(),
    approved:z.boolean(),
    result:z.string()

})

const agent=async (state)=>{
   const result= await model.invoke([
    {
        role:"system",
        content:`
        You are a helpful ai assistance.

        if the user is greeting or asking a normal question,
        respond normally and set approval_requires to false.

        if the user requires a sensitive external action,
        such as sending an email or deleting a file, set 
        approval_requires to true.

        Return JSON with:
        {
         "response":"your response",
         "approvalRequires":"true or false"
        }
         The approvalRequires field MUST be a boolean:
- true for sensitive external actions.
- false for greetings and normal questions.
Do not return it as a string.`
    },
    {
        role:"user",
        content:state.prompt
    }
   ]) 

   const parsed= JSON.parse(result.content)
   return {
    aiResponse:parsed.response,
    approval_requires:parsed.approvalRequires
   }

}

const approvalNode=async (state)=>{
    const answer= interrupt({
        message:"Do you approve this action",
        prompt:state.prompt,
        aiResponse:state.aiResponse
    })

    return{
        approved:String(answer).trim().toLowerCase()==="yes"
    }

}

const actionNode=async (state)=>{
    if(state.approved){
        return{
            result:`approved ${state.aiResponse}`
        }
    }else{
        return{
            result:`action reject by human`
        }
    }

}

const shouldContinue=async (state)=>{
    if(state.approval_requires){
        return "approval"
    }else{
        return "__end__"
    }
}

const graph=new StateGraph(customState)
.addNode("agent",agent)
.addNode("approval",approvalNode)
.addNode("action",actionNode)
.addEdge("__start__","agent")
.addConditionalEdges("agent",shouldContinue)
.addEdge("approval","action")
.addEdge("action","__end__")
.compile({checkpointer})



const model = new ChatGroq({
    model: "openai/gpt-oss-120b",
    temperature: 0,
    maxTokens: undefined,
    maxRetries: 2,

});


app.post("/chat",async (req,res)=>{
    const {prompt}=req.body;
    const threadId=randomUUID();

    const result=await graph.invoke(
        {
           prompt,

        },
        {
            configurable:{thread_id:threadId}
        }
    )
    return res.json({
        threadId,
        result:result.result,
        ai:result.aiResponse
    })
    
})

app.post("/chat/resume",async (req,res)=>{
    const {threadId,answer}=req.body;

    const result= await graph.invoke(
        new Command({
            resume:String(answer)
        }),
        {
            configurable:{
                thread_id:threadId
            }
        }
    )
    return res.json({
        threadId,
        result:result.result
    })
    
})








app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
}); 

