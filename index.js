import express from "express";
import dotenv from "dotenv";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai"
import { TavilySearch } from "@langchain/tavily";
import { createAgent,tool } from "langchain";
import { z } from "zod";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { MessagesAnnotation, StateGraph, MemorySaver } from "@langchain/langgraph";
import { MongoClient } from "mongodb"
import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";


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

const tool2= tool(
    ({a,b})=>{
        return `addition of ${a} and ${b} is 7`;

    },{
    name:"Additon_Tool",
    description:"Use this tool to add two numbers",
    schema:z.object({
        a:z.number(),
        b:z.number()
    })
    }
)

const tool3= tool(
    (email,content)=>{
        return `Email sent to ${email} with content: ${content}`;
    },{
        name:"email_sender_tool",
        description:"Use this tool to send an email",
        schema:z.object({
            email:z.string().describe("Email address of the recipient"),
            content:z.string().describe("Content of the email")
        })
    }
)
const tools= [tool1,tool2,tool3];

const toolNode= new ToolNode(tools);

const agent = async (state)=>{
    const result= await model.invoke(state.messages)
    return{
        messages:[result]
    }


}
const shouldContinue=async (state)=>{
    console.log(state.messages)
    if(state.messages[state.messages.length-1].tool_calls.length>0){
        return "tool";
    }else{
        return "__end__"
    }


}

const graph= new StateGraph(MessagesAnnotation)
.addNode("agent",agent)
.addNode("tool",toolNode)
.addEdge("__start__","agent")
.addEdge("tool","agent")
.addConditionalEdges("agent",shouldContinue)
.compile({checkpointer})



const model = new ChatGoogleGenerativeAI({
    model: "gemini-3.5-flash",
    temperature: 0.7,
    maxRetries: 2,

}).bindTools(tools);

app.post("/ai", async (req, res) => {
  const {input}=req.body;
  const result= await graph.invoke({
    messages:[
        {
        role:"user",
        content:input
        }
    ]

  },{configurable:{thread_id: "1"}})
  return res.json(result.messages[result.messages.length-1].content)

})

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
}); 

