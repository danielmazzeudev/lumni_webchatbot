import { Chatbot } from "@/app/components/Chatbot/Chatbot";
import { Footer } from "@/app/components/Footer/Footer";

import Background from "./components/Background/Background";

export default function Home() {
  return (
    <>
      <Background />
      <Chatbot />
      <Footer>
        <small>
          Elaborado e desenvolvido por&nbsp;
          <a href="https://www.lumni.dev.br/" target="_blank" rel="noreferrer" data-neural-repel="true">
            Lumni
          </a>
          &nbsp;/&nbsp;
          <a href="https://www.danielmazzeu.com.br/" target="_blank" rel="noreferrer" data-neural-repel="true">
            Daniel Mazzeu
          </a>
          .
          <br />
          Luna, atendimento inteligente da Lumni. Todos os direitos reservados {new Date().getFullYear()}.
        </small>
      </Footer>
    </>
  );
}
