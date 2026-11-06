// The published image. One place, so the hero, the install block and the footer always agree.
export const IMAGE = "DOCKERHUB_USER/nodewatch:latest";
export const IMAGE_PAGE = `https://hub.docker.com/r/${IMAGE.split(":")[0]}`;

export const RUN_COMMAND = `docker run -d --name nodewatch --restart unless-stopped \\
  --network host \\
  -v nodewatch:/app/data \\
  -v /var/run/docker.sock:/var/run/docker.sock \\
  -v /var/lib/docker:/data-root:ro \\
  -v /proc:/host/proc:ro -v /sys:/host/sys:ro \\
  -v /:/host/root:ro,rslave \\
  -v /opt/arkiv-community-node:/host/root/opt/arkiv-community-node \\
  -e ADMIN_ADDRESSES=0xYourWallet \\
  -e TELEGRAM_BOT_TOKEN=123456:your-bot-token \\
  -e PAGERDUTY_ROUTING_KEY=your-events-v2-key \\
  ${IMAGE}`;
