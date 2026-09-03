/**
 * =====================================================================
 * PROVEDOR LOCAL DE TESTE - assina de verdade, mas NAO vale nada
 * =====================================================================
 *
 * Este provedor gera um certificado proprio e assina com ele. A assinatura
 * e criptograficamente valida - o PDF fica com estrutura PAdES correta e
 * qualquer leitor consegue verificar a integridade - mas o certificado NAO
 * e da cadeia ICP-Brasil. Ou seja: serve para desenvolvimento e teste, e
 * NAO tem valor legal.
 *
 * Por que ele existe: sem ele, ninguem consegue rodar o projeto de ponta a
 * ponta sem contratar um certificado. O aluno testa todo o caminho - PDF,
 * espaco de assinatura, hash, CMS, embutimento, validacao - e so troca o
 * provedor quando for para valer.
 *
 * A API SE RECUSA A USAR ESTE PROVEDOR EM PRODUCAO (ver ambiente.ts).
 */
import forge from "node-forge";
import { ErroDoProvedor, type AssinaturaPronta, type Autorizacao, type CredenciaisDoMedico, type EscopoAssinatura, type PedidoDeAssinatura, type ProvedorDeAssinatura } from "./provedor.js";

/** Cria um par de chaves e um certificado auto-assinado, uma vez por processo. */
function criarCertificado(nome: string, cpf: string) {
  const chaves = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = chaves.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000);

  // Imita o formato do nome em certificado ICP-Brasil de pessoa fisica:
  // "NOME COMPLETO:CPF".
  const atributos = [
    { name: "commonName", value: `${nome}:${cpf}` },
    { name: "countryName", value: "BR" },
    { name: "organizationName", value: "TESTE - SEM VALOR LEGAL" },
  ];
  cert.setSubject(atributos);
  cert.setIssuer(atributos);
  cert.setExtensions([{ name: "keyUsage", digitalSignature: true, nonRepudiation: true }]);
  cert.sign(chaves.privateKey, forge.md.sha256.create());

  return { cert, chavePrivada: chaves.privateKey };
}

export class ProvedorLocalDeTeste implements ProvedorDeAssinatura {
  readonly nome = "local_teste";
  readonly rotulo = "Certificado local de teste (SEM VALOR LEGAL)";

  /** OTP aceito em desenvolvimento. Qualquer outro e recusado, para o
   *  caminho de erro tambem ser exercitado. */
  static readonly OTP_DE_TESTE = "000000";

  async autorizar(credenciais: CredenciaisDoMedico, escopo: EscopoAssinatura): Promise<Autorizacao> {
    if (!/^\d{11}$/.test(credenciais.cpf)) {
      throw new ErroDoProvedor("CPF_DIVERGENTE", "CPF invalido para o certificado.");
    }
    if (credenciais.otp !== ProvedorLocalDeTeste.OTP_DE_TESTE) {
      throw new ErroDoProvedor("OTP_INVALIDO", `Codigo incorreto. Em desenvolvimento, use ${ProvedorLocalDeTeste.OTP_DE_TESTE}.`);
    }
    return {
      token: `local:${credenciais.cpf}:${Date.now()}`,
      expiraEm: new Date(Date.now() + (escopo === "sessao" ? 30 : 5) * 60000),
      escopo,
    };
  }

  async assinar(autorizacao: Autorizacao, pedido: PedidoDeAssinatura): Promise<AssinaturaPronta> {
    if (autorizacao.expiraEm < new Date()) {
      throw new ErroDoProvedor("TOKEN_EXPIRADO", "A autorizacao venceu. Peca um novo codigo no aplicativo.");
    }
    const cpf = autorizacao.token.split(":")[1] ?? "00000000000";
    const { cert, chavePrivada } = criarCertificado("MEDICO DE TESTE", cpf);

    // CMS/PKCS#7 destacado, montado a mao.
    //
    // POR QUE A MAO: as bibliotecas prontas calculam o messageDigest a
    // partir do conteudo que voce entrega. Aqui nao ha conteudo - ha o
    // HASH, e so ele. E assim que a assinatura em nuvem funciona: o
    // provedor recebe o hash e o usa COMO messageDigest, sem calcular
    // nada de novo. Montar a estrutura a mao e o que faz este provedor de
    // teste se comportar igual a um provedor de verdade.
    const der = montarCmsDeHash(pedido.hashHex, cert, chavePrivada, new Date());
    return {
      cmsBase64: der.toString("base64"),
      idNoProvedor: `local-${Date.now()}`,
      // Provedor de teste nao tem carimbo do tempo de autoridade certificadora.
      carimboEm: null,
      titular: { nome: "MEDICO DE TESTE", cpf },
    };
  }
}


/**
 * Monta um CMS/SignedData destacado em que o messageDigest E o hash
 * recebido. E a forma que os provedores de assinatura em nuvem devolvem.
 */
function montarCmsDeHash(hashHex: string, cert: forge.pki.Certificate, chave: forge.pki.rsa.PrivateKey, quando: Date): Buffer {
  const { asn1, pki, util } = forge;
  const oid = (valor: string) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(valor).getBytes());
  const algoritmo = (valor: string) =>
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [oid(valor), asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, "")]);

  const hash = Buffer.from(hashHex, "hex").toString("binary");

  // Atributos autenticados: e sobre ELES que a assinatura RSA e feita.
  const atributo = (tipo: string, valor: forge.asn1.Asn1) =>
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      oid(tipo),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [valor]),
    ]);

  // Os OIDs vem do forge com tipo "string | undefined"; aqui eles existem.
  const OID_CONTENT_TYPE = pki.oids.contentType!;
  const OID_SIGNING_TIME = pki.oids.signingTime!;
  const OID_MESSAGE_DIGEST = pki.oids.messageDigest!;
  const OID_DATA = pki.oids.data!;
  const OID_SHA256 = pki.oids.sha256!;
  const OID_RSA = pki.oids.rsaEncryption!;
  const OID_SIGNED_DATA = pki.oids.signedData!;

  const atributos = [
    atributo(OID_CONTENT_TYPE, oid(OID_DATA)),
    atributo(OID_SIGNING_TIME, asn1.create(asn1.Class.UNIVERSAL, asn1.Type.UTCTIME, false, asn1.dateToUtcTime(quando))),
    atributo(OID_MESSAGE_DIGEST, asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, hash)),
  ];

  // A assinatura cobre o SET OF dos atributos (nao o marcador [0] implicito).
  const setDeAtributos = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, atributos);
  const md = forge.md.sha256.create();
  md.update(asn1.toDer(setDeAtributos).getBytes());
  const assinatura = chave.sign(md);

  const certAsn1 = pki.certificateToAsn1(cert);
  // tbsCertificate: [0]=versao, [1]=serie, [2]=algoritmo, [3]=emissor
  const emissor = (certAsn1.value as forge.asn1.Asn1[])[0]!;
  const nomeDoEmissor = (emissor.value as forge.asn1.Asn1[])[3]!;

  const signerInfo = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(1).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      nomeDoEmissor,
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, util.hexToBytes(cert.serialNumber)),
    ]),
    algoritmo(OID_SHA256),
    // Os mesmos atributos, agora como [0] IMPLICIT.
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, atributos),
    algoritmo(OID_RSA),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, assinatura),
  ]);

  const signedData = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(1).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [algoritmo(OID_SHA256)]),
    // Destacado: o conteudo nao vai junto, so o tipo.
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [oid(OID_DATA)]),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [certAsn1]),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [signerInfo]),
  ]);

  const contentInfo = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    oid(OID_SIGNED_DATA),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [signedData]),
  ]);

  return Buffer.from(asn1.toDer(contentInfo).getBytes(), "binary");
}
