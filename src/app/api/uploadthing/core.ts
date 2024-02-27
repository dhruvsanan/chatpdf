import { createUploadthing, type FileRouter } from "uploadthing/next";
import { UploadThingError } from "uploadthing/server";
import { getKindeServerSession } from '@kinde-oss/kinde-auth-nextjs/server'
import { db } from "@/db/index";
import { PDFLoader } from 'langchain/document_loaders/fs/pdf'
import { OpenAIEmbeddings } from 'langchain/embeddings/openai'
import { PineconeStore } from 'langchain/vectorstores/pinecone'
import { getPineconeClient } from '@/lib/pinecone'

const f = createUploadthing();
 
 
export const ourFileRouter = {
  pdfUploader: f({ pdf: { maxFileSize: "8MB" } })
    .middleware(async () => {
      const { getUser } = getKindeServerSession()
      const user = getUser()

      if (!user || !user.id) throw new Error('Unauthorized')


      return { userId: user.id }
    })
    .onUploadComplete(async ({ metadata, file }) => {
      const createdFile = await db.file.create({
        data: {
          key: file.key,
          name: file.name,
          userId: metadata.userId,
          url: file.url,
          uploadStatus: 'PROCESSING',
        },
      })

      try{
        const response= await fetch(file.url)
        const blob = await response.blob()
        const loader = new PDFLoader(blob)
        

        const pageLevelDocs = await loader.load()
        const pagesAmt = pageLevelDocs.length

        const pinecone = await getPineconeClient()
        const pineconeIndex = pinecone.Index('chatpdf')
        console.log(pineconeIndex)

        const embeddings = new OpenAIEmbeddings({
          openAIApiKey: process.env.OPENAI_API_KEY,
        })

        await PineconeStore.fromDocuments(pageLevelDocs,embeddings,{
          pineconeIndex,
          namespace: createdFile.id
        })
        await db.file.update({
          data: {
            uploadStatus: 'SUCCESS',
          },
          where: {
            id: createdFile.id,
          },
        })
      } catch(err){
        await db.file.update({
          data: {
            uploadStatus: 'FAILED',
          },
          where: {
            id: createdFile.id,
          },
        })
      }
      return { uploadedBy: metadata.userId };
    }),
} satisfies FileRouter;
 
export type OurFileRouter = typeof ourFileRouter;
