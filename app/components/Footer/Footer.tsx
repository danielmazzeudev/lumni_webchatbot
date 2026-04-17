import "./Footer.css";

interface FooterInterface {
  children: React.ReactNode;
}

export function Footer({ children }: FooterInterface) {
  return <footer>{children}</footer>;
}
