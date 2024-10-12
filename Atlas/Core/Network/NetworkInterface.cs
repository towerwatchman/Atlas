﻿using Atlas.UI;
using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security.Policy;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using System.Windows.Controls;
using System.Windows.Threading;

namespace Atlas.Core.Network
{
    public class NetworkInterface
    {
        private static readonly HttpClient _httpClient = new HttpClient();       

        private void client_DownloadProgressChanged(object sender, DownloadProgressChangedEventArgs e)
        {
            InterfaceHelper.SplashWindow.Dispatcher.Invoke((Action)(() =>
            {
                InterfaceHelper.SplashProgressBar.Value = InterfaceHelper.ProgressBarStartValue + e.ProgressPercentage/2;
                Logging.Logger.Info(InterfaceHelper.SplashProgressBar.Value);
            }));
        }

        public static JArray RequestJSON(string url)
        {
            JArray jsonArray = new JArray();
            string response = string.Empty;
            var client = new HttpClient();
            client.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
            client.DefaultRequestHeaders.Add("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7");
            try
            {
                HttpResponseMessage rspmsg = client.GetAsync(url).Result;
                rspmsg.EnsureSuccessStatusCode();
                response = rspmsg.Content.ReadAsStringAsync().Result;


                if (response != string.Empty)
                {
                    //stock
                    jsonArray = JArray.Parse(response);

                    /*string fullVersion = jsonArray[0]["name"]!.ToString();
                    string version = jsonArray[0]["name"]!.ToString().Replace("v", "").Split('-')[0];
                    string download_url = jsonArray[0]["assets"][0]["browser_download_url"]!.ToString();

                    return new[] { version, download_url, fullVersion };*/
                }
            }
            catch (Exception ex)
            {
                Logging.Logger.Error(ex);
                return jsonArray;
            }
            return jsonArray;
        }



        internal Task DownloadFile(string downloadUrl, string outputPath)
        {
            Task task = null;
            /*Uri uriResult;

            if (!Uri.TryCreate(uri, UriKind.Absolute, out uriResult))
                throw new InvalidOperationException("URI is invalid.");*/
            //The percentage needs to be split in half
            WebClient webClient = new WebClient();

            webClient.DownloadProgressChanged += new DownloadProgressChangedEventHandler(client_DownloadProgressChanged);
            webClient.DownloadFileCompleted += (s, e) =>
            {
                webClient.Dispose();
                task = Task.CompletedTask;
                // any other code to process the file
            };

            webClient.DownloadFileAsync(new Uri(downloadUrl), outputPath);

            //webClient.Dispose();

            while(task == null)
            {

            }

            return task;
            //await _httpClient.
            //byte[] fileBytes = await _httpClient.GetByteArrayAsync(uri);
            //File.WriteAllBytes(outputPath, fileBytes);

        }
    }
}