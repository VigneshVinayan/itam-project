import cds from '@sap/cds';

const LOG = cds.log('mail');

// E-mail delivery for reports (FRD INT-05).
//
// - With a `mail-api` service configured in cds.requires (an HTTP e-mail / notification API reached
//   through a BTP Destination, e.g. { kind: 'rest', credentials: { destination: 'ITAM_MAIL_API', path: '/send' } })
//   the mail is POSTed there with the PDF as base64 attachment.
// - Without it (local development, tests) the mail is only written to the log and kept in `sent`,
//   so the whole flow can be tried without a mail server.
export default class MailService extends cds.Service {

    sent = [];

    async init() {

        this.on('send', async (req) => {

            const { to, subject, text, attachment } = req.data;

            if (cds.env.requires['mail-api']) {
                const api = await cds.connect.to('mail-api');
                await api.send({
                    method: 'POST',
                    path: '/',
                    data: {
                        to,
                        subject,
                        text,
                        attachments: attachment ? [{
                            fileName: attachment.fileName,
                            contentType: 'application/pdf',
                            content: attachment.content.toString('base64')
                        }] : []
                    }
                });
                return { channel: 'mail-api' };
            }

            this.sent.push({ to, subject, text, attachment });
            LOG.info(`(no mail-api configured) e-mail "${subject}" to ${to.join(', ')}` +
                (attachment ? ` with ${attachment.fileName} (${attachment.content.length} bytes)` : ''));
            return { channel: 'log' };
        });

        await super.init();
    }
}
