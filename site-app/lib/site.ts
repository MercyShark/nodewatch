// The published image. One place, so the hero, the install block and the footer always agree.
export const IMAGE = "rishabhdev04/nodewatch:latest";
export const IMAGE_PAGE = `https://hub.docker.com/r/${IMAGE.split(":")[0]}`;

export const RUN_COMMAND = `docker run -d --name nodewatch --restart unless-stopped \\
  --network host \\
  -v nodewatch:/app/data \\
  -v /var/run/docker.sock:/var/run/docker.sock \\
  -v /var/lib/docker:/data-root:ro \\
  -v /proc:/host/proc:ro -v /sys:/host/sys:ro \\
  -v /:/host/root:ro,rslave \\
  -v /opt/arkiv-community-node:/host/root/opt/arkiv-community-node \\
  -e HOST=0.0.0.0 -e PORT=8000 \\
  -e PUBLIC_ORIGIN=http://YOUR_SERVER_IP:8000 \\
  -e ADMIN_ADDRESSES=0xYourWallet \\
  -e TELEGRAM_BOT_TOKEN=123456:your-bot-token \\
  -e PAGERDUTY_ROUTING_KEY=your-events-v2-key \\
  -e SLACK_WEBHOOK_URL=https://hooks.slack.com/services/your/webhook \\
  ${IMAGE}`;
