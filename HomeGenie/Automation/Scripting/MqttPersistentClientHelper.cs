/*
    This file is part of HomeGenie Project source code.

    HomeGenie is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    HomeGenie is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with HomeGenie.  If not, see <http://www.gnu.org/licenses/>.  
*/

/*
 *     Project Homepage: http://homegenie.it
 */

using System;
using System.Collections.Generic;
using System.Net;
using System.Text;
using System.Threading;

using MQTTnet;
using MQTTnet.Client;
using MQTTnet.Protocol;
using MQTTnet.Serializer;

namespace HomeGenie.Automation.Scripting
{

    /// <summary>
    /// MQTT client helper.
    /// Class instance accessor: **MqttClient**
    /// </summary>
    [Serializable]
    public class MqttPersistentClientHelper
    {
        class TopicSubscription
        {
            public string Topic;
            public MqttQualityOfServiceLevel Qos;
        }

        private static MqttFactory factory = new MqttFactory();
        private NetworkCredential networkCredential = null;
        private MqttEndPoint endPoint = new MqttEndPoint();
        private bool usingWebSockets;

        private MqttClient mqttClient;
        private List<TopicSubscription> subscribedTopics;
        private Action<string, string> messageCallback;

        private IMqttClientOptions options;


        public MqttPersistentClientHelper()
        {
            mqttClient = (MqttClient)factory.CreateMqttClient();
            mqttClient.Connected += (sender, args) =>
            {
                if (subscribedTopics != null)
                {
                    foreach (var topic in subscribedTopics)
                    {
                        mqttClient.SubscribeAsync(topic.Topic, topic.Qos);
                    }

                }
            };
            mqttClient.Disconnected += (sender, args) =>
            {
                if ((args != null) && (args.Exception != null))
                {
                    Console.WriteLine(args.Exception.Message);
                    if (args.Exception is MQTTnet.Exceptions.MqttCommunicationClosedGracefullyException)
                    {
                        // If Disconnect() is called, this event will be fired, so handle the GracefullyClosed Exception 
                        return;
                    }
                }

                // so not gracefully Closed ? ok so lets retry
                Console.WriteLine("MqttPersistentClientHelper will try to reconnect in 5s");
                Thread.Sleep(5000);
                mqttClient.ConnectAsync(options);
            };
        }

        /// <summary>
        /// Sets the MQTT server to use.
        /// </summary>
        /// <param name="server">MQTT server address.</param>
        /// <param name="messageCallback">Callback for receiving the subscribed topic messages.</param>
        public MqttPersistentClientHelper Service(string server, int port, string clientId, Action<string, string> messageCallback)
        {
            endPoint.Address = server;
            endPoint.Port = port;
            endPoint.ClientId = clientId;
            this.messageCallback = messageCallback;

            mqttClient.ApplicationMessageReceived += MessageReceived;
            options = GetMqttOption(endPoint.ClientId);

            return this;
        }

        /// <summary>
        /// Disconnects from the MQTT server.
        /// </summary>
        public MqttPersistentClientHelper Disconnect()
        {
            mqttClient.DisconnectAsync();
            return this;
        }

        /// <summary>
        /// Subscribe the specified topic.
        /// </summary>
        /// <param name="topic">Topic name.</param>
        public MqttPersistentClientHelper Subscribe(string topic, int qoslevel = (int)MqttQualityOfServiceLevel.AtMostOnce)
        {
            if (subscribedTopics == null)
                subscribedTopics = new List<TopicSubscription>();
            subscribedTopics.Add(new TopicSubscription() { Topic = topic, Qos = (MqttQualityOfServiceLevel)qoslevel });
            if (mqttClient != null)
            {
                if (mqttClient.IsConnected)
                {
                    mqttClient.SubscribeAsync(topic, (MqttQualityOfServiceLevel)qoslevel);
                }
            }
            return this;
        }

        /// <summary>
        /// Unsubscribe the specified topic.
        /// </summary>
        /// <param name="topic">Topic name.</param>
        public MqttPersistentClientHelper Unsubscribe(string topic)
        {
            if (subscribedTopics == null)
                subscribedTopics = new List<TopicSubscription>();
            if (mqttClient != null)
            {
                if (mqttClient.IsConnected)
                {
                    mqttClient.UnsubscribeAsync(topic);
                }
            }
            return this;
        }

        /// <summary>
        /// Publish a message to the specified topic.
        /// </summary>
        /// <param name="topic">Topic name.</param>
        /// <param name="message">Message text.</param>
        public MqttPersistentClientHelper Publish(string topic, string message)
        {
            if (mqttClient != null)
            {
                mqttClient.PublishAsync(topic, message, MqttQualityOfServiceLevel.AtLeastOnce, false);
            }
            return this;
        }

        /// <summary>
        /// Publish a message to the specified topic.
        /// </summary>
        /// <param name="topic">Topic name.</param>
        /// <param name="message">Message text as byte array.</param>
        public MqttPersistentClientHelper Publish(string topic, byte[] message)
        {
            if (mqttClient != null)
            {
                mqttClient.PublishAsync(topic, Encoding.UTF8.GetString(message), MqttQualityOfServiceLevel.AtLeastOnce, false);
            }
            return this;
        }

        /// <summary>
        /// Publish a message to the specified topic.
        /// </summary>
        /// <param name="topic">Topic name.</param>
        /// <param name="message">Message text as byte array.</param>
        public MqttPersistentClientHelper Publish(string topic, string message, int qos)
        {
            if (mqttClient != null)
            {
                mqttClient.PublishAsync(topic, message, (MqttQualityOfServiceLevel)qos, false);
            }
            return this;
        }


        /// <summary>
        /// Publish a message to the specified topic.
        /// </summary>
        /// <param name="topic">Topic name.</param>
        /// <param name="message">Message text as byte array.</param>
        public MqttPersistentClientHelper Publish(string topic, string message, int qos, bool retain)
        {
            if (mqttClient != null)
            {
                mqttClient.PublishAsync(topic, message, (MqttQualityOfServiceLevel)qos, retain);
            }
            return this;
        }

        /// <summary>
        /// Connect over WebSocket (default = false).
        /// </summary>
        /// <returns>NetHelper.</returns>
        /// <param name="useWebSocket">true/false</param>
        public MqttPersistentClientHelper UsingWebSockets(bool useWebSocket)
        {
            usingWebSockets = useWebSocket;
            return this;
        }

        /// <summary>
        /// Use provided credentials when connecting.
        /// </summary>
        /// <returns>NetHelper.</returns>
        /// <param name="user">Username.</param>
        /// <param name="pass">Password.</param>
        public MqttPersistentClientHelper WithCredentials(string user, string pass)
        {
            networkCredential = new NetworkCredential(user, pass);
            return this;
        }

        public void Reset()
        {
            networkCredential = null;
            endPoint = new MqttEndPoint();
            Disconnect();
        }

        public void Connect()
        {
            mqttClient.ConnectAsync(options);
        }

        #region private helper methods
        private IMqttClientOptions GetMqttOption(string clientId)
        {
            var builder = new MqttClientOptionsBuilder()
                .WithProtocolVersion(MqttProtocolVersion.V311)
                .WithClientId(clientId)
                .WithCleanSession(false);
            /*
            .WithWillMessage(new MqttApplicationMessage()
            {
                Payload = Encoding.UTF8.GetBytes("Hello World!!!"),
                Topic = "/homegenie",
                Retain = true,
                QualityOfServiceLevel = MqttQualityOfServiceLevel.AtLeastOnce
            });
            */
            // TODO: ...
            //.WithKeepAlivePeriod(TimeSpan.FromSeconds(...))
            //.WithCommunicationTimeout(TimeSpan.FromSeconds(...))
            // .WithTls()
            //.WithCleanSession();
            if (usingWebSockets)
            {
                builder.WithWebSocketServer(endPoint.Address + ":" + endPoint.Port + "/mqtt");
            }
            else
            {
                builder.WithTcpServer(endPoint.Address, endPoint.Port);
            }
            if (networkCredential != null)
            {
                builder.WithCredentials(networkCredential.UserName, networkCredential.Password);
            }
            return builder.Build();
        }

        public void MessageReceived(object sender, MqttApplicationMessageReceivedEventArgs args)
        {
            var msg = Encoding.UTF8.GetString(args.ApplicationMessage.Payload);
            messageCallback(args.ApplicationMessage.Topic, msg);
        }

        #endregion

    }
}
